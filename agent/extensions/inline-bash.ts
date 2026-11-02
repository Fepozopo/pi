/**
 * Inline Bash Extension - expands inline bash commands in user prompts.
 *
 * Start pi with this extension:
 *   pi -e ./examples/extensions/inline-bash.ts
 *
 * Then type prompts with inline bash:
 *   What's in !{pwd}?
 *   The current branch is !{git branch --show-current} and status: !{git status --short}
 *   My node version is !{node --version}
 *
 * The !{command} patterns are executed and replaced with their output before
 * the prompt is sent to the agent. Combined stdout/stderr is capped at Pi's
 * standard tool-output byte limit; truncated output includes an explicit warning.
 *
 * Note: Regular !command syntax (whole-line bash) is preserved and works as before.
 */
import { DEFAULT_MAX_BYTES, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register inline command expansion with bounded output and truncation warnings.
 * @param pi Host API used to register input handling and execute commands.
 * @returns Nothing; registration installs the input handler for this runtime.
 */
export default function (pi: ExtensionAPI): void {
	const PATTERN = /!\{([^}]+)\}/g;
	const TIMEOUT_MS = 30000;

	/** Expand inline commands in the incoming event; preserve images and report failures through ctx.ui. */
	pi.on("input", async (event, ctx) => {
		const text = event.text;

		// Don't process if it's a whole-line bash command (starts with !)
		// This preserves the existing !command behavior
		if (text.trimStart().startsWith("!") && !text.trimStart().startsWith("!{")) {
			return { action: "continue" };
		}

		// Check if there are any inline bash patterns
		if (!PATTERN.test(text)) {
			return { action: "continue" };
		}

		// Reset regex state after test()
		PATTERN.lastIndex = 0;

		let result = text;
		const expansions: Array<{ command: string; output: string; error?: string }> = [];

		// Find all matches first (to avoid issues with replacing while iterating)
		const matches: Array<{ full: string; command: string }> = [];
		let match = PATTERN.exec(text);
		while (match) {
			matches.push({ full: match[0], command: match[1] });
			match = PATTERN.exec(text);
		}

		// Execute each command and collect results
		for (const { full, command } of matches) {
			try {
				// Pi enforces a combined stdout/stderr cap and terminates overflowing commands.
				const bashResult = await pi.exec("bash", ["-c", command], {
					timeout: TIMEOUT_MS,
					maxBuffer: DEFAULT_MAX_BYTES,
				});

				const output = bashResult.stdout || bashResult.stderr || "";
				const trimmed = output.trim();

				const error = bashResult.truncated
					? `output truncated: exceeded ${DEFAULT_MAX_BYTES} bytes; command terminated`
					: bashResult.code !== 0 ? `exit code ${bashResult.code}` : undefined;
				expansions.push({ command, output: trimmed, error });

				// Keep the warning in model context too, including when no UI is available.
				const replacement = bashResult.truncated
					? `${trimmed}${trimmed ? "\n" : ""}[${error}]`
					: trimmed;
				// Command output is literal data, not String.replace's $-substitution syntax.
				result = result.replace(full, () => replacement);
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				expansions.push({ command, output: "", error: errorMsg });
				result = result.replace(full, `[error: ${errorMsg}]`);
			}
		}

		// Show what was expanded (if UI available)
		if (ctx.hasUI && expansions.length > 0) {
			const summary = expansions
				.map((e) => {
					const status = e.error ? ` (${e.error})` : "";
					const preview = e.output.length > 50 ? `${e.output.slice(0, 50)}...` : e.output;
					return `!{${e.command}}${status} -> "${preview}"`;
				})
				.join("\n");

			ctx.ui.notify(`Expanded ${expansions.length} inline command(s):\n${summary}`, "info");
		}

		return { action: "transform", text: result, images: event.images };
	});
}
