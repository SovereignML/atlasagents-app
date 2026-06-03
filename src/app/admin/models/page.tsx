"use client"

import { useCallback, useEffect, useState } from "react"

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

type ProbeResult = {
  id: string
  label: string
  model: string
  keySlot: "primary" | "secondary"
  ok: boolean
  status?: number
  ms: number
  error?: string
}

type TestResult = {
  ok: boolean
  status?: number
  ms: number
  content?: string
  error?: string
}

export default function AdminModelsPage() {
  const [probes, setProbes] = useState<ProbeResult[] | null>(null)
  const [probeErr, setProbeErr] = useState<string | null>(null)
  const [probeLoading, setProbeLoading] = useState(true)

  const [modelId, setModelId] = useState<string>("")
  const [prompt, setPrompt] = useState("Reply with exactly: PONG")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const loadProbes = useCallback(async () => {
    setProbeLoading(true)
    setProbeErr(null)
    try {
      const res = await fetch("/api/test-models")
      if (!res.ok) throw new Error(`Probe failed: ${res.status}`)
      const json = (await res.json()) as { results: ProbeResult[] }
      setProbes(json.results)
      if (json.results.length > 0 && !modelId) setModelId(json.results[0].id)
    } catch (e) {
      setProbeErr(String(e))
    } finally {
      setProbeLoading(false)
    }
  }, [modelId])

  useEffect(() => {
    loadProbes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runTest() {
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch("/api/test-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, prompt }),
      })
      const json = (await res.json()) as TestResult
      setResult(json)
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
        description="NVIDIA fallback provider (integrate.api.nvidia.com). Keys are read from NVIDIA_API_KEY_PRIMARY / NVIDIA_API_KEY_SECONDARY. Set LLM_DEFAULT_PROVIDER=nvidia to provision bots directly against NVIDIA."
      />

      <Card>
        <CardHeader>
          <CardTitle>Configured fallback models</CardTitle>
          <CardDescription>
            Live liveness probe of each model with its paired key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {probeLoading && (
            <p className="text-sm text-muted-foreground">Probing…</p>
          )}
          {probeErr && <p className="text-sm text-destructive">{probeErr}</p>}
          {probes && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {probes.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.model}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.keySlot}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={p.ok ? "secondary" : "destructive"}
                        title={p.error}
                      >
                        {p.ok ? `OK ${p.status ?? ""}` : `FAIL ${p.status ?? ""}`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {p.ms} ms
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
              onClick={loadProbes}
              disabled={probeLoading}
            >
              Re-probe
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Try a model</CardTitle>
          <CardDescription>
            Run a short completion against a configured model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="model">Model</Label>
            <select
              id="model"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              {(probes ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.keySlot})
                </option>
              ))}
            </select>
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
          <Button onClick={runTest} disabled={running || !modelId}>
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
