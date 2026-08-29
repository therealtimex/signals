# Signals Writing payload reference

Send agent-tool calls through the health-pinned `run-signals-pp-cli.sh agent-tools invoke --agent
--stdin < file` path. These tagged examples are validation fixtures; replace IDs and text with the
current run's server/context values.

## Call sequence by mode

- **voice build:** `get_writing_context` → `query_content`/`get_content` only for admissible
  self-authored samples → `upsert_voice_profile` → present profile → wait →
  `approve_voice_profile` with the user's thread evidence.
- **spine:** `get_writing_context` → `get_content` only for explicit unredacted sources → write a
  complete launch-writing file → `upsert_launch` → read the server-derived spine hash.
- **draft:** run `writing-cli.cjs id` as needed → draft from the spine under one overlay →
  `measure` → create audit → `verdict` → `precheck` → `upsert_variant`.
- **adapt/revise/humanize:** read the current variant plus spine → preserve or add lineage as
  required → repeat measure/audit/precheck → update the same variant unless a derived alternative
  is explicitly required.
- **audit:** read current units, spine, voice, and pinned rule versions → recompute the complete
  audit → `verdict` → `precheck` → `upsert_variant` with unchanged units.
- **approve/export:** render the persisted approval card → wait → `materialize_variant`; use
  `revoke_variant_approval` when approval is withdrawn. Export only from the returned content item.
- **publish:** only after a separate explicit instruction, POST the materialized item and target to
  `/api/content/send-to-agent`; the publish workspace owns the job and browser lifecycle.

Each agent-tool payload file uses `{"tool":"<name>","input":{...}}` and is sent with
`run-signals-pp-cli.sh agent-tools invoke --agent --stdin < file`. A retry preserves IDs and the
request hash while correcting only the server-reported reason.

## Launch writing patch

```json signals-writing:example:launch-writing-patch
{"schemaVersion":1,"goal":"awareness","surfaces":[{"platform":"x","surface":"x/post","targetId":"target_x_demo"}],"sources":[{"id":"src_demo001","kind":"note","text":"Aster reduced review time from 10 minutes to 6 minutes.","enteredAt":1750000000,"sensitivity":{"level":"public","reason":"public_default"}}],"spine":{"schemaVersion":1,"id":"spn_demo001","launchId":"launch_demo","goal":"awareness","audience":{"nicheIds":[]},"sources":[{"id":"src_demo001","kind":"note","text":"Aster reduced review time from 10 minutes to 6 minutes.","enteredAt":1750000000,"sensitivity":{"level":"public","reason":"public_default"}}],"claims":[{"id":"clm_demo001","kind":"number","text":"10 minutes to 6 minutes","sourceId":"src_demo001","verbatimRequired":true,"sensitivity":"public","includeInOutput":true}],"message":{"core":"Aster reduced review time.","supporting":[],"proofClaimIds":["clm_demo001"]},"extractedBy":{"workflowRunId":"run_demo","at":1750000000}},"voiceProfile":null,"voicePrecedence":"voice_first","approvalPolicy":"explicit","runs":[{"workflowRunId":"run_demo","mode":"draft","startedAt":1750000000,"rtxThreadSlug":"thread_demo"}]}
```

## Evidence spine (read-back shape includes server hash)

```json signals-writing:example:spine
{"schemaVersion":1,"id":"spn_demo001","launchId":"launch_demo","goal":"awareness","audience":{"nicheIds":[]},"sources":[{"id":"src_demo001","kind":"note","text":"Aster reduced review time from 10 minutes to 6 minutes.","enteredAt":1750000000,"sensitivity":{"level":"public","reason":"public_default"}}],"claims":[{"id":"clm_demo001","kind":"number","text":"10 minutes to 6 minutes","sourceId":"src_demo001","verbatimRequired":true,"sensitivity":"public","includeInOutput":true}],"message":{"core":"Aster reduced review time.","supporting":[],"proofClaimIds":["clm_demo001"],"cta":{"intent":"none"}},"extractedBy":{"workflowRunId":"run_demo","at":1750000000},"hash":"spine_hash_demo"}
```

## Variant writing input

```json signals-writing:example:variant-input
{"schemaVersion":1,"platform":"x","surface":"x/post","targetId":"target_x_demo","goal":"awareness","formulaId":"x/post/data-point@1","overlay":{"id":"overlay:x","version":1},"core":{"version":1},"voiceProfile":null,"voicePrecedence":"voice_first","spine":{"id":"spn_demo001","hash":"spine_hash_demo"},"units":{"texts":["Aster reduced review time from 10 minutes to 6 minutes."],"count":1,"chars":[55]},"claimMap":[{"claimId":"clm_demo001","present":true,"unit":0,"verbatim":true}],"lineage":{"sourceIds":["src_demo001"]},"media":{"assetIds":[]},"audit":{"schemaVersion":1,"auditedAt":1750000001,"auditor":{"kind":"agent","skillVersion":"1.0.0","workflowRunId":"run_demo"},"overlay":{"id":"overlay:x","version":1},"core":{"version":1},"verdict":"pass","findings":[],"claims":{"total":1,"preserved":1,"altered":[],"missing":[],"invented":[],"privateIncluded":[]},"hard":{"units":1,"chars":[55],"limit":280,"hashtags":0,"links":0,"mediaCount":0},"voice":{"status":"none","skipped":[]},"heuristics":{"applied":[],"conflicts":[],"skippedForVoice":[]}}}
```

## Generation metadata

```json signals-writing:example:generation
{"schemaVersion":1,"kind":"signals-writing","mode":"draft","model":null,"skill":{"name":"signals-writing","version":"1.0.0"},"agent":{"workflowRunId":"run_demo","rtxThreadSlug":"thread_demo","briefPath":"workflow-runs/run_demo/brief.md"},"requestHash":"wr1:run_demo:x/post:draft:1","generatedAt":1750000001}
```

## Audit input

```json signals-writing:example:audit-input
{"schemaVersion":1,"auditedAt":1750000001,"auditor":{"kind":"agent","skillVersion":"1.0.0","workflowRunId":"run_demo"},"overlay":{"id":"overlay:x","version":1},"core":{"version":1},"verdict":"pass","findings":[],"claims":{"total":1,"preserved":1,"altered":[],"missing":[],"invented":[],"privateIncluded":[]},"hard":{"units":1,"chars":[55],"limit":280,"hashtags":0,"links":0,"mediaCount":0},"voice":{"status":"none","skipped":[]},"heuristics":{"applied":[],"conflicts":[],"skippedForVoice":[]}}
```

## Voice profile input

```json signals-writing:example:voice-profile-input
{"schemaVersion":1,"id":"vp_demo001","label":"default","platforms":[],"samples":[{"id":"vs_demo001","text":"Short sample one.","source":{"kind":"pasted","pastedAt":1750000000},"authorship":"self","approved":true},{"id":"vs_demo002","text":"Short sample two.","source":{"kind":"pasted","pastedAt":1750000000},"authorship":"self","approved":true},{"id":"vs_demo003","text":"Short sample three.","source":{"kind":"pasted","pastedAt":1750000000},"authorship":"self","approved":true}],"fingerprint":{"sentenceLength":{"medianWords":3,"range":[3,3]},"openers":["Short"],"closers":[],"punctuation":["periods"],"vocabulary":{"keep":[],"avoid":[]},"formats":["one-line"],"emoji":"none","hashtags":"none","protectedQuirks":[],"taboo":[]},"signatureLines":[{"text":"Short sample one.","sampleId":"vs_demo001"}],"derivedBy":{"method":"agent","workflowRunId":"run_demo","rtxThreadSlug":"thread_demo","at":1750000000}}
```

## Materialize approved variant

```json signals-writing:example:materialize-input
{"variantId":"variant_demo","approval":{"by":"user","evidence":{"kind":"thread_message","workspaceSlug":"signals","threadSlug":"thread_demo","note":"approve variant_demo"},"note":"approve variant_demo"}}
```

## Approve voice profile

```json signals-writing:example:approve-voice-input
{"id":"vp_demo001","version":1,"evidence":{"kind":"thread_message","workspaceSlug":"signals","threadSlug":"thread_demo","note":"approve vp_demo001 version 1"}}
```

## Send materialized item to publish agent

```json signals-writing:example:send-to-agent-body
{"contentItemId":"content_demo","targets":[{"targetId":"target_x_demo"}]}
```

## Error-driven retry

Keep IDs and request hashes stable. Correct `details.reason` and `details.path`, rerun measurement,
verdict, and precheck, then resend the same operation. Database-dependent failures such as missing
targets, voice versions, lineage nodes, or media remain server authority.
