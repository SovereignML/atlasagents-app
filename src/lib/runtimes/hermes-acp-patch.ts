import { bashSingleQuote } from "./python-install"

/**
 * Keep a model the chat UI picks on the provider it names. Hermes' ACP server
 * (0.19.0) re-detects the provider on every model switch, and while the current
 * provider is OpenRouter it checks other providers' static catalogs first, so
 * `openrouter:anthropic/claude-sonnet-4.6` is moved to GMI (whose catalog also
 * lists it) and the chat fails without a GMI key. Skip that detection when the
 * id names the current provider, which is how Lite names every model it offers
 * (liteModelId). Idempotent; when a Hermes release no longer has the line, it
 * warns rather than fails, and the patch should be dropped or redone.
 */
export const HERMES_ACP_PROVIDER_PATCH = {
  from: "            if target_provider == current_provider:",
  to: '            if target_provider == current_provider and not raw_model.strip().lower().startswith(current_provider.lower() + ":"):',
}

export function buildHermesAcpProviderPatch(venv: string): string {
  const python = `${venv}/bin/python`
  const patch = [
    "import importlib.util, os, sys",
    'path = importlib.util.find_spec("acp_adapter.server").origin',
    "src = open(path, encoding='utf-8').read()",
    "old, new = os.environ['FROM'], os.environ['TO']",
    "if new in src: print('hermes acp provider patch: already applied'); sys.exit(0)",
    "if src.count(old) != 1: print('warn: hermes acp provider patch does not apply to this Hermes; chat model switches may change provider', file=sys.stderr); sys.exit(0)",
    "open(path, 'w', encoding='utf-8').write(src.replace(old, new))",
    "print('hermes acp provider patch: applied')",
  ].join("\n")
  return `step "patch_hermes_acp_provider"
FROM=${bashSingleQuote(HERMES_ACP_PROVIDER_PATCH.from)} TO=${bashSingleQuote(HERMES_ACP_PROVIDER_PATCH.to)} ${bashSingleQuote(python)} -c ${bashSingleQuote(patch)}`
}
