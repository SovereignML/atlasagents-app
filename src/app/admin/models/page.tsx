"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { HERMES_MIN_CONTEXT } from "@/lib/runtimes/labels"

type ConfiguredModel = {
  model: string
  role: string
  listed: boolean
  allowed: boolean
  ok: boolean
  status?: number
  ms: number
  error?: string
}

type CatalogModel = {
  id: string
  name: string
  contextLength: number | null
  promptPrice: string | null
  completionPrice: string | null
}

type AllowedModel = {
  slug: string
  label: string
  kind: "chat" | "image" | "moderation"
  contextLength: number | null
  enabled: boolean
}


type TestResult = {
  ok: boolean
  status?: number
  ms: number
  content?: string
  error?: string
}

const CATALOG_PAGE_SIZE = 50
const KINDS: AllowedModel["kind"][] = ["chat", "image", "moderation"]

/** $/token strings from OpenRouter rendered as $/M tokens. */
function perMillion(price: string | null): string {
  if (price == null) return "-"
  const n = Number(price)
  if (!Number.isFinite(n)) return "-"
  return `$${(n * 1_000_000).toFixed(2)}`
}

function formatContext(len: number | null): string {
  if (!len) return "-"
  return `${Math.round(len / 1000)}k`
}

export default function AdminModelsPage() {
  const [configured, setConfigured] = useState<ConfiguredModel[] | null>(null)
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null)
  const [allowed, setAllowed] = useState<AllowedModel[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [mutateErr, setMutateErr] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [allowedOnly, setAllowedOnly] = useState(true)
  const [newSlug, setNewSlug] = useState("")
  const [newKind, setNewKind] = useState<AllowedModel["kind"]>("chat")

  const [model, setModel] = useState("")
  const [prompt, setPrompt] = useState("Reply with exactly: PONG")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const loadAllowed = useCallback(async () => {
    const res = await fetch("/api/admin/models")
    const json = (await res.json()) as {
      models?: AllowedModel[]
      error?: string
    }
    if (!res.ok) throw new Error(json.error ?? `Allowlist load: ${res.status}`)
    setAllowed(json.models ?? [])
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const probeRes = fetch("/api/test-models").then(async (res) => {
        const json = (await res.json()) as {
          configured?: ConfiguredModel[]
          catalog?: CatalogModel[]
          error?: string
        }
        if (!res.ok) throw new Error(json.error ?? `Load failed: ${res.status}`)
        setConfigured(json.configured ?? [])
        setCatalog(json.catalog ?? [])
        setModel((m) => m || json.configured?.[0]?.model || "")
      })
      await Promise.all([probeRes, loadAllowed()])
    } catch (e) {
      setLoadErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [loadAllowed])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const catalogById = useMemo(
    () => new Map((catalog ?? []).map((m) => [m.id, m])),
    [catalog],
  )
  const allowedSet = useMemo(
    () =>
      new Set((allowed ?? []).filter((m) => m.enabled).map((m) => m.slug)),
    [allowed],
  )

  const filtered = useMemo(() => {
    if (!catalog) return []
    const q = search.trim().toLowerCase()
    return catalog.filter(
      (m) =>
        (!allowedOnly || allowedSet.has(m.id)) &&
        (!q ||
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q)),
    )
  }, [catalog, search, allowedOnly, allowedSet])

  async function mutateAllowed(
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, unknown>,
  ) {
    setMutating(true)
    setMutateErr(null)
    try {
      const res = await fetch("/api/admin/models", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string }
        throw new Error(json.error ?? `${method} failed: ${res.status}`)
      }
      await loadAllowed()
    } catch (e) {
      setMutateErr(String(e))
    } finally {
      setMutating(false)
    }
  }

  async function addModel(slug: string, kind: AllowedModel["kind"]) {
    const fromCatalog = catalogById.get(slug)
    await mutateAllowed("POST", {
      slug,
      label: fromCatalog?.name ?? slug,
      kind,
      contextLength: fromCatalog?.contextLength ?? null,
    })
    setNewSlug("")
  }

  async function syncMetadata() {
    setMutating(true)
    setMutateErr(null)
    try {
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      })
      const json = (await res.json()) as { updated?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? `Sync failed: ${res.status}`)
      await loadAllowed()
    } catch (e) {
      setMutateErr(String(e))
    } finally {
      setMutating(false)
    }
  }

  async function runTest() {
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch("/api/test-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt }),
      })
      const json = (await res.json()) as TestResult & { error?: string }
      setResult(res.ok ? json : { ok: false, ms: 0, error: json.error })
    } catch (e) {
      setResult({ ok: false, ms: 0, error: String(e) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Admin · Models"
        description="OpenRouter account allowlist and live catalog. The list below mirrors what the OpenRouter account permits. Change it here whenever the account settings change. Probes and test runs use the platform OPENROUTER_API_KEY."
      />

      <Card>
        <CardHeader>
          <CardTitle>Platform default models</CardTitle>
          <CardDescription>
            The models bots are routed to by default, live-probed with a
            1-token completion. Every default must be allowed and listed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {loadErr && <p className="text-sm text-destructive">{loadErr}</p>}
          {configured && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Used as</TableHead>
                  <TableHead>Listed</TableHead>
                  <TableHead>Allowed</TableHead>
                  <TableHead>Probe</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configured.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className="font-medium">{m.model}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.role}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.listed ? "secondary" : "destructive"}>
                        {m.listed ? "listed" : "not listed"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          allowedSet.has(m.model) ? "secondary" : "destructive"
                        }
                      >
                        {allowedSet.has(m.model) ? "allowed" : "not allowed"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={m.ok ? "secondary" : "destructive"}
                        title={m.error}
                      >
                        {m.ok ? `OK ${m.status ?? ""}` : `FAIL ${m.status ?? ""}`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {m.ms} ms
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
            >
              Re-probe
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed models</CardTitle>
          <CardDescription>
            {allowed
              ? `${allowed.filter((m) => m.enabled).length} enabled of ${allowed.length}. Mirror of the OpenRouter account allowlist. Disable to keep the row but hide the model; remove to drop it entirely.`
              : "Mirror of the OpenRouter account allowlist."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-slug">Add model</Label>
              <Input
                id="new-slug"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="author/slug from the catalog below"
                className="w-80"
                list="catalog-all-models"
              />
            </div>
            <select
              value={newKind}
              onChange={(e) =>
                setNewKind(e.target.value as AllowedModel["kind"])
              }
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => addModel(newSlug.trim(), newKind)}
              disabled={mutating || !newSlug.trim()}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={syncMetadata}
              disabled={mutating}
              title="Refresh context windows from the OpenRouter catalog (drives Hermes-readiness)."
            >
              Sync metadata
            </Button>
          </div>
          <datalist id="catalog-all-models">
            {(catalog ?? []).map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
          {mutateErr && <p className="text-sm text-destructive">{mutateErr}</p>}
          {allowed && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Context</TableHead>
                  <TableHead>Hermes</TableHead>
                  <TableHead>Prompt $/M</TableHead>
                  <TableHead>Completion $/M</TableHead>
                  <TableHead>Listed</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {allowed.map((m) => {
                  const cat = catalogById.get(m.slug)
                  const ctx = m.contextLength ?? cat?.contextLength ?? null
                  const hermesReady =
                    m.kind === "chat" && ctx != null && ctx >= HERMES_MIN_CONTEXT
                  return (
                    <TableRow
                      key={m.slug}
                      className={m.enabled ? undefined : "opacity-50"}
                    >
                      <TableCell>
                        <div className="font-medium">{m.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.slug}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{m.kind}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatContext(ctx)}
                      </TableCell>
                      <TableCell>
                        {m.kind === "chat" ? (
                          <Badge variant={hermesReady ? "secondary" : "destructive"}>
                            {hermesReady
                              ? "ready"
                              : ctx == null
                                ? "unknown"
                                : "too small"}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {perMillion(cat?.promptPrice ?? null)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {perMillion(cat?.completionPrice ?? null)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={cat ? "secondary" : "destructive"}>
                          {cat ? "listed" : "not listed"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          disabled={mutating}
                          onChange={(e) =>
                            mutateAllowed("PATCH", {
                              slug: m.slug,
                              enabled: e.target.checked,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={mutating}
                          onClick={() =>
                            mutateAllowed("DELETE", { slug: m.slug })
                          }
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OpenRouter catalog</CardTitle>
          <CardDescription>
            {catalog
              ? `${catalog.length} models in the live catalog${
                  search.trim() || allowedOnly
                    ? ` · ${filtered.length} shown`
                    : ""
                }${
                  filtered.length > CATALOG_PAGE_SIZE
                    ? ` · showing first ${CATALOG_PAGE_SIZE}`
                    : ""
                }`
              : "Live catalog from openrouter.ai/api/v1/models."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <Input
              placeholder="Search by slug or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowedOnly}
                onChange={(e) => setAllowedOnly(e.target.checked)}
              />
              Account-allowed only
            </label>
          </div>
          {catalog && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Context</TableHead>
                  <TableHead>Prompt $/M</TableHead>
                  <TableHead>Completion $/M</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, CATALOG_PAGE_SIZE).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.name}</span>
                        {allowedSet.has(m.id) && (
                          <Badge variant="secondary">allowed</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.id}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatContext(m.contextLength)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {perMillion(m.promptPrice)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {perMillion(m.completionPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!allowedSet.has(m.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={mutating}
                          onClick={() => addModel(m.id, "chat")}
                        >
                          Allow
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setModel(m.id)}
                      >
                        Use
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Try a model</CardTitle>
          <CardDescription>
            Run a short completion against any OpenRouter slug.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="author/slug, e.g. minimax/minimax-m2.5"
              className="max-w-md"
              list="allowed-models"
            />
            <datalist id="allowed-models">
              {(allowed ?? [])
                .filter((m) => m.enabled)
                .map((m) => (
                  <option key={m.slug} value={m.slug} />
                ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
            />
          </div>
          <Button onClick={runTest} disabled={running || !model.trim()}>
            {running ? "Running…" : "Run"}
          </Button>

          {result && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="mb-2 flex gap-3 text-xs text-muted-foreground">
                <Badge variant={result.ok ? "secondary" : "destructive"}>
                  {result.ok ? "OK" : "FAIL"} {result.status ?? ""}
                </Badge>
                <span className="self-center">{result.ms} ms</span>
              </div>
              <pre className="whitespace-pre-wrap break-words">
                {result.content ?? result.error ?? "(no content)"}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
