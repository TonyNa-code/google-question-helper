#!/usr/bin/env node

const { execFileSync } = require("child_process");

const SENSITIVE_MARKERS = [
  "锦" + "祥",
  "jin" + "xiang",
  "jin" + "xiangde",
  "/" + "Users" + "/" + "na",
  "/" + "Users" + "/",
  "na" + "@",
  "Mac" + "Book",
  "Mac" + "Book-Pro",
  "C:" + "\\Users" + "\\",
  "/home/" + "runner",
  "D:" + "\\a" + "\\"
];

const failures = [];

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function gitMaybe(args) {
  try {
    return git(args);
  } catch (error) {
    if (error.status === 1) return "";
    throw error;
  }
}

function checkOutput(label, output) {
  if (output.trim()) {
    failures.push(`${label}\n${output.trim()}`);
  }
}

function grepArgs(ref) {
  const args = ["grep", "-n", "-I", "-F"];
  for (const marker of SENSITIVE_MARKERS) {
    args.push("-e", marker);
  }
  args.push(ref, "--", ".");
  return args;
}

function checkGitMetadata() {
  const output = git(["log", "--format=%H%x09%an <%ae>%x09%cn <%ce>", "HEAD"]);
  const hits = output
    .split("\n")
    .filter((line) => SENSITIVE_MARKERS.some((marker) => line.includes(marker)))
    .join("\n");
  checkOutput("Sensitive marker found in commit metadata:", hits);
}

function checkCurrentTree() {
  const args = ["grep", "-n", "-I", "-F"];
  for (const marker of SENSITIVE_MARKERS) {
    args.push("-e", marker);
  }
  args.push("--", ".");
  checkOutput("Sensitive marker found in current tracked files:", gitMaybe(args));
}

function checkReachableHistory() {
  const commits = git(["rev-list", "HEAD"]).trim().split("\n").filter(Boolean);
  const hits = [];

  for (const commit of commits) {
    const output = gitMaybe(grepArgs(commit));
    if (output.trim()) hits.push(output.trim());
  }

  checkOutput("Sensitive marker found in reachable file history:", hits.join("\n"));
}

checkGitMetadata();
checkCurrentTree();
checkReachableHistory();

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("Privacy scan passed.");
