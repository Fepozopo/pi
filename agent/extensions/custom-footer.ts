/**
 * Persistent footer showing context tokens before the percentage (16k/500k 3.2%).
 * Loads automatically; /footer toggles back to Pi's built-in footer.
 */
import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Format a token count for display, retaining precision below 10k. */
function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${Number((count / 1000000).toFixed(1))}M`;
}

/** Register the automatic footer and a command to toggle it for this runtime. */
export default function (pi: ExtensionAPI): void {
	let enabled = true;

	/** Install the footer for the supplied session, or restore Pi's default. */
	function applyFooter(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		if (!enabled) {
			ctx.ui.setFooter(undefined);
			return;
		}

		// Pi owns rendering and git watching; dispose the subscription on replacement.
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
			let cacheKey = "";
			let totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
			let cacheHitRate: number | undefined;
			let context: ReturnType<ExtensionContext["getContextUsage"]>;

			return {
				dispose: unsubscribe,
				/** No styled output is cached, so theme changes need no invalidation. */
				invalidate(): void {},
				/** Return directory, usage/model, and extension status lines within width. */
				render(width: number): string[] {
					const manager = ctx.sessionManager;
					const model = ctx.model;
					const key = JSON.stringify([
						manager.getSessionId(), manager.getLeafId(),
						model?.provider, model?.id, model?.contextWindow,
					]);
					// Avoid rescanning the session on every streaming redraw. Include the leaf
					// so tree navigation invalidates context even without appending entries.
					if (key !== cacheKey) {
						totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
						cacheHitRate = undefined;
						for (const entry of manager.getEntries()) {
							const usage = entry.type === "message"
								? ((entry.message.role === "assistant" || entry.message.role === "toolResult")
									? entry.message.usage : undefined)
								: ((entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary")
									? entry.usage : undefined);
							if (!usage) continue;
							totals.input += usage.input;
							totals.output += usage.output;
							totals.cacheRead += usage.cacheRead;
							totals.cacheWrite += usage.cacheWrite;
							totals.cost += usage.cost.total;
							if (entry.type === "message" && entry.message.role === "assistant") {
								const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
								cacheHitRate = prompt > 0 ? usage.cacheRead / prompt * 100 : undefined;
							}
						}
						// Pi's estimate includes cache tokens and respects compaction; cumulative
						// session input/output totals are not the current context size.
						context = ctx.getContextUsage();
						cacheKey = key;
					}

					const homeRelative = relative(homedir(), manager.getCwd());
					const insideHome = homeRelative !== ".." && !homeRelative.startsWith(`..${sep}`) && !isAbsolute(homeRelative);
					let directory = insideHome ? (homeRelative ? `~${sep}${homeRelative}` : "~") : manager.getCwd();
					const branch = footerData.getGitBranch();
					if (branch) directory += ` (${branch})`;
					const sessionName = manager.getSessionName();
					if (sessionName) directory += ` • ${sessionName}`;

					const parts: string[] = [];
					if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
					if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
					if (totals.cacheRead) parts.push(`R${formatTokens(totals.cacheRead)}`);
					if (totals.cacheWrite) parts.push(`W${formatTokens(totals.cacheWrite)}`);
					if ((totals.cacheRead || totals.cacheWrite) && cacheHitRate !== undefined) parts.push(`CH${cacheHitRate.toFixed(1)}%`);
					// Pi exposes OAuth detection through its authenticated model registry.
					const subscription = model && (model.provider === "kimi-coding" || (
						ctx.modelRegistry.isUsingOAuth(model) &&
						ctx.modelRegistry.getProvider(model.provider)?.auth.oauth?.isSubscription === true
					));
					if (totals.cost || subscription) parts.push(`$${totals.cost.toFixed(3)}${subscription ? " (sub)" : ""}`);

					const used = context?.tokens == null ? "?" : formatTokens(context.tokens);
					const capacity = formatTokens(context?.contextWindow ?? model?.contextWindow ?? 0);
					const percent = context?.percent == null ? "?" : context.percent.toFixed(1);
					// Read live settings so /settings changes are reflected without reloading.
					const auto = pi.getSettings().compaction?.enabled !== false ? " (auto)" : "";
					const contextText = `${used}/${capacity} ${percent}%${auto}`;
					const color = (context?.percent ?? 0) > 90 ? "error" : (context?.percent ?? 0) > 70 ? "warning" : "dim";
					const left = truncateToWidth(
						(parts.length ? theme.fg("dim", `${parts.join(" ")} `) : "") + theme.fg(color, contextText), width,
					);
					let right = model?.id ?? "no-model";
					if (model?.reasoning) right += ` • ${ctx.thinkingLevel && ctx.thinkingLevel !== "off" ? ctx.thinkingLevel : "thinking off"}`;
					if (model && footerData.getAvailableProviderCount() > 1) {
						const withProvider = `(${model.provider}) ${right}`;
						if (visibleWidth(left) + 2 + visibleWidth(withProvider) <= width) right = withProvider;
					}
					const room = width - visibleWidth(left) - 2;
					right = room > 0 ? truncateToWidth(right, room, "") : "";
					const padding = right ? " ".repeat(width - visibleWidth(left) - visibleWidth(right)) : "";
					const lines = [truncateToWidth(theme.fg("dim", directory), width), left + padding + theme.fg("dim", right)];
					const statuses = [...footerData.getExtensionStatuses()].sort(([a], [b]) => a.localeCompare(b));
					if (statuses.length) {
						lines.push(truncateToWidth(statuses.map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim()).join(" "), width));
					}
					return lines;
				},
			};
		});
	}

	pi.on("session_start", (_event, ctx) => applyFooter(ctx));
	pi.registerCommand("footer", {
		description: "Toggle context-token footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			applyFooter(ctx);
			ctx.ui.notify(enabled ? "Context-token footer enabled" : "Default footer restored", "info");
		},
	});
}
