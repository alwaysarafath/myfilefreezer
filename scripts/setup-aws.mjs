// EXPERIMENTAL — not yet tested against a real AWS account. Review before running.
// The manual Setup section in the README is the tested path.
//
// Sets up everything MyFileFreezer needs in your AWS account, then writes .env.local.
//
//   npm run setup-aws
//
// Uses your own AWS CLI sign-in (`aws login` or `aws configure`, or AWS_PROFILE=...) with
// admin rights -- NOT the app's restricted key, which is why this never reads .env.local
// for credentials. Shows which identity it will use and asks before changing anything.
//
// Safe to run twice: anything that already exists is left alone and reported as such.

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketEncryptionCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import {
  IAMClient,
  GetUserCommand,
  CreateUserCommand,
  PutUserPolicyCommand,
  ListAccessKeysCommand,
  CreateAccessKeyCommand,
} from "@aws-sdk/client-iam";
import { BudgetsClient, DescribeBudgetCommand, CreateBudgetCommand } from "@aws-sdk/client-budgets";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const ENV_FILE = ".env.local";
const IAM_USER = "myfilefreezer";
const POLICY_NAME = "myfilefreezer-bucket-access";
const BUDGET_NAME = "myfilefreezer-monthly";
const BUDGET_USD = "5";
const LIFECYCLE_ID = "abort-incomplete-multipart";
const ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

// Same as the README. Deliberately no DeleteObject or RestoreObject.
const policyFor = (bucket) => ({
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "Objects",
      Effect: "Allow",
      Action: [
        "s3:PutObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:GetObject",
      ],
      Resource: `arn:aws:s3:::${bucket}/*`,
    },
    {
      Sid: "ReindexListing",
      Effect: "Allow",
      Action: "s3:ListBucket",
      Resource: `arn:aws:s3:::${bucket}`,
    },
  ],
});

// ---------------------------------------------------------------------------------------

const rl = createInterface({ input: stdin, output: stdout });
const summary = [];
const done = (step, outcome) => {
  summary.push([step, outcome]);
  console.log(`  ${outcome.padEnd(16)} ${step}`);
};
const ask = async (q, fallback = "") => {
  const a = (await rl.question(fallback ? `${q} [${fallback}]: ` : `${q}: `)).trim();
  return a || fallback;
};
const yes = async (q) => /^y(es)?$/i.test((await rl.question(`${q} [y/N]: `)).trim());
const isCode = (err, ...codes) =>
  codes.includes(err?.name) || codes.includes(err?.Code) || codes.includes(err?.code);
function fail(message) {
  console.error(`\n${message}\nNothing after this point was changed. Re-running is safe.`);
  rl.close();
  process.exit(1);
}

/** KEY=value lines only; comments and everything else are preserved on write. */
function readEnv() {
  if (!existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(ENV_FILE, "utf8")
      .split("\n")
      .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()]),
  );
}

function writeEnv(values) {
  let text = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, "utf8")
    : existsSync(".env.local.example")
      ? readFileSync(".env.local.example", "utf8")
      : "";
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, "m");
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  writeFileSync(ENV_FILE, text);
  chmodSync(ENV_FILE, 0o600);
}

// ---------------------------------------------------------------------------------------

console.log("MyFileFreezer AWS setup (experimental)\n");

// 1. Who are we acting as?
let identity;
try {
  identity = await new STSClient({}).send(new GetCallerIdentityCommand({}));
} catch (err) {
  fail(
    `Could not find AWS credentials (${err?.name ?? err}).\n` +
      "Install the AWS CLI and sign in first: `aws login` or `aws configure`.\n" +
      "To use a named profile: AWS_PROFILE=name npm run setup-aws",
  );
}
console.log(`AWS account : ${identity.Account}`);
console.log(`Signed in as: ${identity.Arn}`);
if (identity.Arn.endsWith(":root")) {
  console.log("\nWarning: these are root-user credentials. It works, but an admin IAM");
  console.log("identity or `aws login` is safer for day-to-day use.");
}
if (identity.Arn.endsWith(`:user/${IAM_USER}`)) {
  fail(`These are the app's own restricted credentials (${IAM_USER}). Use an admin sign-in.`);
}
console.log("");

// 2. Questions.
const env = readEnv();
const region = await ask("Region", env.AWS_REGION || "us-east-1");
const bucket = (await ask("Bucket name (globally unique, lowercase)", env.AWS_S3_BUCKET)).toLowerCase();
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
  fail("Bucket names are 3-63 characters: lowercase letters, numbers, dots and hyphens.");
}
const email = await ask("Email for the $5/month budget alert");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("That does not look like an email address.");

const { pricingFor } = await import("../src/lib/pricing.ts");
if (pricingFor(region).isFallback) {
  console.log(`\nNote: the thaw-cost estimator has no prices for ${region}; it will use us-east-1 rates.`);
}

// 3. Will .env.local values be replaced? Decide before touching AWS, so a "no" changes nothing
//    and never leaves an orphaned access key behind.
const iam = new IAMClient({});
let userExists = true;
try {
  await iam.send(new GetUserCommand({ UserName: IAM_USER }));
} catch (err) {
  if (!isCode(err, "NoSuchEntity", "NoSuchEntityException")) throw err;
  userExists = false;
}
const userKeys = userExists
  ? ((await iam.send(new ListAccessKeysCommand({ UserName: IAM_USER }))).AccessKeyMetadata ?? [])
  : [];
const haveUsableKey = Boolean(
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY &&
    userKeys.some((k) => k.AccessKeyId === env.AWS_ACCESS_KEY_ID),
);
const replacing = [
  env.AWS_REGION && env.AWS_REGION !== region && "AWS_REGION",
  env.AWS_S3_BUCKET && env.AWS_S3_BUCKET !== bucket && "AWS_S3_BUCKET",
  !haveUsableKey && env.AWS_ACCESS_KEY_ID && "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY",
].filter(Boolean);

console.log(`\nAbout to set up s3://${bucket} in ${region} for account ${identity.Account}.`);
if (replacing.length > 0) {
  console.log(`This will REPLACE existing values in ${ENV_FILE}: ${replacing.join(", ")}`);
}
if (!(await yes("Continue?"))) {
  console.log("Stopped. Nothing was changed.");
  rl.close();
  process.exit(0);
}
console.log("");

// 4. Bucket.
const s3 = new S3Client({ region });
try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  done("Bucket", "already exists");
} catch (err) {
  const status = err?.$metadata?.httpStatusCode;
  if (status === 404 || isCode(err, "NotFound", "NoSuchBucket")) {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        // us-east-1 is the default location and must not be named explicitly.
        ...(region === "us-east-1" ? {} : { CreateBucketConfiguration: { LocationConstraint: region } }),
      }),
    );
    done("Bucket", "created");
  } else if (status === 403) {
    fail(`The name "${bucket}" is taken by another AWS account. Choose a different one.`);
  } else if (status === 301 || isCode(err, "PermanentRedirect")) {
    fail(`A bucket named "${bucket}" already exists in a different region than ${region}.`);
  } else {
    throw err;
  }
}

// Both of these only ever make the bucket stricter, so re-applying is the same as skipping.
await s3.send(
  new PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    },
  }),
);
done("Block all public access", "on");

await s3.send(
  new PutBucketEncryptionCommand({
    Bucket: bucket,
    ServerSideEncryptionConfiguration: {
      Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
    },
  }),
);
done("Default encryption SSE-S3", "on");

// CORS: never overwrite someone else's rules.
let corsRules = [];
try {
  corsRules = (await s3.send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? [];
} catch (err) {
  if (!isCode(err, "NoSuchCORSConfiguration")) throw err;
}
const corsIsOurs = corsRules.some(
  (r) =>
    r.AllowedOrigins?.includes(ORIGINS[0]) &&
    r.ExposeHeaders?.includes("ETag") &&
    r.ExposeHeaders?.includes("x-amz-checksum-sha256"),
);
if (corsIsOurs) {
  done("CORS", "already set");
} else if (corsRules.length > 0) {
  done("CORS", "SKIPPED");
  console.log("                   The bucket has other CORS rules; left untouched. Add the");
  console.log("                   rule from the README by hand or uploads will fail.");
} else {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ORIGINS,
            AllowedMethods: ["PUT", "POST", "GET", "HEAD"],
            AllowedHeaders: ["*"],
            // Without ETag the browser cannot read part IDs and every upload fails at the end.
            ExposeHeaders: ["ETag", "x-amz-checksum-sha256"],
          },
        ],
      },
    }),
  );
  done("CORS", "set");
}

// Lifecycle: a Put replaces ALL rules, so merge ours into whatever is there.
let lifecycleRules = [];
try {
  lifecycleRules =
    (await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))).Rules ?? [];
} catch (err) {
  if (!isCode(err, "NoSuchLifecycleConfiguration")) throw err;
}
if (lifecycleRules.some((r) => r.ID === LIFECYCLE_ID)) {
  done("Lifecycle: abort incomplete uploads", "already set");
} else {
  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          ...lifecycleRules,
          {
            ID: LIFECYCLE_ID,
            Status: "Enabled",
            Filter: { Prefix: "" },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
          },
        ],
      },
    }),
  );
  done("Lifecycle: abort incomplete uploads", "added");
}

// 5. IAM user, policy, access key.
if (userExists) {
  done(`IAM user ${IAM_USER}`, "already exists");
} else {
  await iam.send(
    new CreateUserCommand({
      UserName: IAM_USER,
      Tags: [{ Key: "app", Value: "myfilefreezer" }],
    }),
  );
  done(`IAM user ${IAM_USER}`, "created");
}
// Our own named policy, so re-applying keeps it in step with the bucket name.
await iam.send(
  new PutUserPolicyCommand({
    UserName: IAM_USER,
    PolicyName: POLICY_NAME,
    PolicyDocument: JSON.stringify(policyFor(bucket)),
  }),
);
done("IAM policy (no delete, no restore)", "applied");

let newKey = null;
if (haveUsableKey) {
  done("Access key", "already in .env.local");
} else if (userKeys.length >= 2) {
  fail(
    `${IAM_USER} already has 2 access keys (the AWS maximum) and neither is in ${ENV_FILE}.\n` +
      "Delete an unused one in IAM -> Users -> myfilefreezer -> Security credentials, then re-run.",
  );
} else {
  newKey = (await iam.send(new CreateAccessKeyCommand({ UserName: IAM_USER }))).AccessKey;
  done("Access key", "created");
}

// 6. Budget. Account-wide: it watches your whole AWS bill, not just this bucket.
const budgets = new BudgetsClient({ region: "us-east-1" });
let budgetOutcome;
try {
  try {
    await budgets.send(
      new DescribeBudgetCommand({ AccountId: identity.Account, BudgetName: BUDGET_NAME }),
    );
    budgetOutcome = "already exists";
  } catch (err) {
    if (!isCode(err, "NotFoundException")) throw err;
    const alert = (type, threshold) => ({
      Notification: {
        NotificationType: type,
        ComparisonOperator: "GREATER_THAN",
        Threshold: threshold,
        ThresholdType: "PERCENTAGE",
      },
      Subscribers: [{ SubscriptionType: "EMAIL", Address: email }],
    });
    await budgets.send(
      new CreateBudgetCommand({
        AccountId: identity.Account,
        Budget: {
          BudgetName: BUDGET_NAME,
          BudgetType: "COST",
          TimeUnit: "MONTHLY",
          BudgetLimit: { Amount: BUDGET_USD, Unit: "USD" },
        },
        NotificationsWithSubscribers: [
          alert("ACTUAL", 85),
          alert("ACTUAL", 100),
          alert("FORECASTED", 100),
        ],
      }),
    );
    budgetOutcome = "created";
  }
  done(`$${BUDGET_USD}/month budget -> ${email}`, budgetOutcome);
} catch (err) {
  // Commonly: IAM identities are blocked from billing until the root user enables
  // "IAM user and role access to Billing information". Not fatal -- everything else works.
  done(`$${BUDGET_USD}/month budget`, "FAILED");
  console.log(`                   ${err?.name ?? "Error"}: ${err?.message ?? err}`);
  console.log("                   Create it by hand: Billing -> Budgets -> Monthly cost budget.");
}

// 7. .env.local -- the secret is written, never printed.
const updates = { AWS_REGION: region, AWS_S3_BUCKET: bucket };
if (newKey) {
  updates.AWS_ACCESS_KEY_ID = newKey.AccessKeyId;
  updates.AWS_SECRET_ACCESS_KEY = newKey.SecretAccessKey;
}
writeEnv(updates);
done(`${ENV_FILE}`, "written");

// 8. Summary.
const keyId = newKey?.AccessKeyId ?? env.AWS_ACCESS_KEY_ID ?? "";
console.log(`
Done.
  Bucket      s3://${bucket} (${region})
  App user    ${IAM_USER}, access key ${keyId.slice(0, 8)}… (secret saved to ${ENV_FILE}, not shown)
  Budget      ${budgetOutcome ?? "not set -- see above"}

Next:
  - Sign-in: set up Google (README) or add DISABLE_AUTH=true to ${ENV_FILE}
  - npm run dev, then open http://localhost:3000`);
rl.close();
