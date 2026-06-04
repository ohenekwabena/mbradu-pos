// Bootstraps the first Owner account (ADR-0003 / MP-2).
//
// Uses the Supabase Auth admin API (service-role key) so the auth user is
// created with all the correct internal bookkeeping (email identity, tokens),
// pre-confirmed, and tagged with role=owner in user metadata — the
// on_auth_user_created trigger then creates the matching `profiles` row.
//
// Usage (credentials via .env.local — preferred, keeps them out of shell history):
//   Add to .env.local:
//     SUPABASE_SERVICE_ROLE_KEY=sb_secret_...   (or the legacy service_role JWT)
//     OWNER_EMAIL=owner@example.com
//     OWNER_PASSWORD=their-strong-password
//     OWNER_NAME=Shop Owner            (optional)
//   Then:  npm run bootstrap:owner
//
// Or pass as args:  npm run bootstrap:owner -- owner@example.com 'password' 'Shop Owner'

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(path = ".env.local") {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local — rely on the ambient environment.
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const [, , emailArg, passwordArg, ...nameParts] = process.argv;
const email = emailArg ?? process.env.OWNER_EMAIL;
const password = passwordArg ?? process.env.OWNER_PASSWORD;
const fullName = nameParts.join(" ") || process.env.OWNER_NAME || null;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set.");
if (!serviceKey)
  fail("SUPABASE_SERVICE_ROLE_KEY is not set (add it to .env.local).");
if (!email || !password)
  fail("Owner email and password are required (args or OWNER_EMAIL/OWNER_PASSWORD).");

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { role: "owner", ...(fullName ? { full_name: fullName } : {}) },
});

if (error) {
  if (/already.*registered|already exists/i.test(error.message)) {
    fail(
      `An account for ${email} already exists. Delete it in Supabase Studio (Authentication → Users) and re-run, or use a different email.`,
    );
  }
  fail(`Failed to create Owner: ${error.message}`);
}

const userId = data.user.id;

// Confirm the trigger created an owner profile (service role bypasses RLS).
const { data: profile, error: profileError } = await supabase
  .from("profiles")
  .select("id, role, full_name")
  .eq("id", userId)
  .single();

if (profileError) {
  fail(
    `Owner auth user created (${userId}), but reading its profile failed: ${profileError.message}`,
  );
}

if (profile.role !== "owner") {
  fail(
    `Owner auth user created (${userId}), but profile role is "${profile.role}", expected "owner".`,
  );
}

console.log(`✓ Owner bootstrapped: ${email}`);
console.log(`  user id: ${userId}`);
console.log(`  profile role: ${profile.role}${profile.full_name ? ` (${profile.full_name})` : ""}`);
