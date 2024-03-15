import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv } from "node:process";
import CLITable from "cli-table3";
import dedent from "ts-dedent";

if (require.main === module) {
	try {
		console.log(dedent`
			Generate Dependabot Changeset
			=============================
			`);

		main(processArgs());
	} catch (e) {
		if (e instanceof Error) {
			console.error(e.message);
		} else {
			console.error(`Error: ${e}`);
		}
		process.exit(1);
	}
}

type Args = {
	prNumber: string;
	packageName: string;
	packageJSONPath: string;
};

function processArgs(): Args {
	const args = [...argv];
	if (args[0] === process.execPath) {
		args.shift();
	}
	if (args[0] === __filename) {
		args.shift();
	}
	if (args.length !== 3) {
		throw new Error(dedent`
			Incorrect arguments, please provide three arguments:
			- PR: The number of the current Dependabot PR
			- Package: The name of the workers-sdk package whose dependencies are being updated
			- PackageJSON: The path to the package JSON being updated by Dependabot`);
	}
	return {
		prNumber: args[0],
		packageName: args[1],
		packageJSONPath: args[2],
	};
}

function main({ prNumber, packageName, packageJSONPath }: Args): void {
	const diffLines = getPackageJsonDiff(resolve(packageJSONPath));
	const changes = parseDiffForChanges(diffLines);
	if (changes.size === 0) {
		console.warn(dedent`
			WARN: No dependency changes detected for "${packageName}".
			`);
		return;
	}
	const changesetHeader = generateChangesetHeader(packageName);
	const commitMessage = generateCommitMessage(packageName, changes);
	console.log(dedent`
		INFO: Writing changeset with the following commit message
		${commitMessage}`);
	writeChangeSet(prNumber, changesetHeader, commitMessage);
	commitAndPush(commitMessage);
}

export function getPackageJsonDiff(packageJSONPath: string): string[] {
	return executeCommand("git", ["diff", "HEAD~1", packageJSONPath]);
}

export type Change = {
	from: string;
	to: string;
};

export function parseDiffForChanges(
	diffLines: (string | undefined)[]
): Map<string, Change> {
	const diffLineRegex = new RegExp(`^[+-]\\s*"(.*)":\\s"(.*)",?`);
	const changes = new Map<string, Change>();
	for (const line of diffLines) {
		const match = line?.match(diffLineRegex);
		if (match) {
			const [matchedLine, name, version] = match;
			const fromToProp = matchedLine.startsWith("+") ? "to" : "from";
			const change = changes.get(name) ?? { from: "", to: "" };
			change[fromToProp] = version;
			changes.set(name, change);
		}
	}
	return changes;
}

export function generateChangesetHeader(packageName: string): string {
	return dedent`
		---
		"${packageName}": patch
		---
		`;
}

export function generateCommitMessage(
	packageName: string,
	changes: Map<string, Change>
): string {
	const t = new CLITable({
		head: ["Dependency", "From", "To"],
		style: {
			head: [], //disable colors in header cells
			border: [], //disable colors for the border
		},
	});
	for (const [name, { from, to }] of changes.entries()) {
		if (!from || !to) {
			console.warn(dedent`
				WARN: Unexpected changes for package "${name}", from: "${from}", to: "${to}".
				Could not determine upgrade versions.`);
		} else {
			t.push([name, from, to]);
		}
	}
	return dedent`
		chore: update dependencies of "${packageName}" package

		The following dependency versions have been updated:
		${t.toString()}
		`;
}

export function writeChangeSet(
	prNumber: string,
	changesetHeader: string,
	commitMessage: string
): void {
	writeFileSync(
		`.changeset/dependabot-update-${prNumber}.md`,
		changesetHeader + "\n" + commitMessage
	);
}

export function commitAndPush(commitMessage: string): void {
	executeCommand("git", ["add", ".changeset"]);
	executeCommand("git", ["commit", "-m", commitMessage]);
	executeCommand("git", ["push"]);
}

function executeCommand(command: string, args: string[]): string[] {
	const { output, error, status, stdout, stderr } = spawnSync(command, args, {
		encoding: "utf-8",
	});
	if (status || error) {
		throw error ?? new Error(stderr);
	}
	return output.flatMap((chunk) => chunk?.split("\n")).filter(isDefined);
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
