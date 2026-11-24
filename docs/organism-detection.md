# Organism detection

How the first step of multi-step species ID finds the living things in a
photo, so the user can tap one (the bee, not the sunflower) and `/identify`
runs on just that region.

**Recommendation: OWLv2 base (`google/owlv2-base-patch16-ensemble`,
Apache-2.0), at 768 px, with concrete prompts grouped into coarse labels.**
It is the only permissively licensed candidate that put the right label on
nearly every organism in the test photos, it exports to ONNX cleanly and runs
under ONNX Runtime 1.27, and its text side can be precomputed like BioCLIP's
species embeddings. Its weak points are latency (about 2–3 s per photo on an
M4, more on Cloud Run) and small or camouflaged animals, white crab spiders
above all. A prototype `POST /detect` in `crates/observing-species-id` uses
it.

## Candidates

| Model | License | Weights | ONNX under ORT 1.27 | CPU latency (M4, 4 threads) | Boxes on the test photos |
|---|---|---|---|---|---|
| **OWLv2 B/16 @ 768** | Apache-2.0 | 620 MB (365 MB image-side ONNX; 102 MB int8) | Yes: exported with `torch.onnx`, opset 17; also tested in the Rust service | **2.0–3.0 s** (ORT) | Best labels. 14 of 17 organisms found and correctly labelled, incl. the bee and the fish. Misses both crab spiders and the aphids. |
| OWLv2 B/16 @ 960 (native) | Apache-2.0 | same | Yes | 4.5–6.2 s (ORT) | Same as 768, a little cleaner; ~2.5× slower. |
| OWLv2 L/14 | Apache-2.0 | 1.75 GB | Not tried | 19.6 s (PyTorch) | Cleanest boxes; the only OWL model to label a crab spider `spider`. Far too slow. |
| OWL-ViT B/32 @ 768 | Apache-2.0 | 613 MB (358 MB ONNX) | Yes | **0.4 s** (ORT) | Finds the bee, frog, heron, ladybird and butterfly, but misses the fish and mushrooms, calls the lizard an amphibian, and scores are low (0.1–0.3) so the threshold is fragile; splits a blossom spray into ~15 "flower" boxes. |
| OWL-ViT B/16 | Apache-2.0 | 611 MB | Not tried | 0.9 s (PyTorch) | Missed the bee, the mushrooms and most of the ladybird. |
| Grounding DINO tiny | Apache-2.0 | 689 MB (719 MB ONNX from `onnx-community`) | Yes (pre-exported model ran in ORT 1.27) | 5.2 s (ORT, 800×800) | Good box recall (bee, crab spider, an aphid), but with all 11 prompts in one caption most labels are wrong: frog → reptile, heron → insect, mushrooms → bird, butterfly → spider. |
| MM-Grounding-DINO tiny (o365+goldg+v3det) | Apache-2.0 | 692 MB | Not tried (same architecture as Grounding DINO) | 8.0 s (PyTorch) | Best small-object recall of all: a crab spider, individual blossoms, mushrooms. Labels still often wrong: lizard, frog and fish → insect. |
| LLMDet tiny | Apache-2.0 | 692 MB | Not tried | 9.7 s (PyTorch) | Like MM-Grounding-DINO; ladybird and frog → bird. |
| OmDet-Turbo (Swin-T) | Apache-2.0 | 462 MB | Not tried | 0.8 s (PyTorch) | Missed most organisms at 0.3: no bee, skipper, ladybird or spider; butterfly → bird, frog boxed as both amphibian and bird. |
| YOLO-World | **GPL-3.0** (AILab-CVC/YOLO-World); **AGPL-3.0** (Ultralytics build) | — | — | — | Excluded: copyleft, incompatible with shipping inside an MIT/Apache-2.0 service. |
| YOLOE | **AGPL-3.0** (THU-MIG/yoloe, Ultralytics) | — | — | — | Excluded for the same reason. |
| Florence-2 base | MIT | 463 MB | Not tried | — | Not evaluated. It is generative (an autoregressive decoder emits box tokens), so a Rust port needs a tokenizer plus an encoder/decoder decode loop with KV cache. Worth a look only if OWLv2's recall is the blocker. |

Latency notes: the machine was shared with another session's species-id
benchmark (load average ~10 on 10 cores), so these are best-of-N runs and
the spread is wide. Cloud Run vCPUs are slower per core than an M4; expect
OWLv2 @ 768 to take several seconds there. **Measure on Cloud Run before
building UI around it.** "PyTorch" times are from `transformers` on CPU and
are only good for ranking; "ORT" times are ONNX Runtime 1.27.0, 4 intra-op
threads (the setting `/identify` uses). With 2 threads OWLv2 @ 768 took
~4.2 s.

int8 dynamic quantization of OWLv2 cut the file to 102 MB and time by ~20%,
but dropped the fish and relabelled the knapweed as "plant". Not worth it
yet.

## Test photos

Ten nature photos from Wikimedia Commons, each 1280 px wide, chosen to have
more than one organism and some small ones:

| Photo (Commons file) | License | Organisms |
|---|---|---|
| Sunflower and a bee.jpg | CC BY-SA 4.0 | sunflower, small bee at the centre |
| Misumena vatia Vs Episyrphus balteatus.jpg | CC BY-SA 4.0 | white crab spider, hoverfly, rose petals |
| Crab spider (Misumena vatia) with prey silver-spotted skipper (Hesperia comma).jpg | CC BY-SA 4.0 | white crab spider, skipper, knapweed |
| Seven-spot ladybird on a thistle full of black bean aphids (19585722105).jpg | CC BY-SA 2.0 | ladybird, aphids, thistle |
| Ardea cinerea (Grey heron) eating fish.jpg | CC BY-SA 4.0 | heron, fish in its beak, shrubs |
| Frog on Lily Pad (3926795011).jpg | CC BY-SA 2.0 | frog, lily pads |
| Champignons dans la mousse mushrooms in the moss (948878315).jpg | CC BY 2.0 | tiny mushrooms, moss, trees |
| Peacock butterfly (Aglais io) 2.jpg | CC BY-SA 3.0 | butterfly, blackthorn blossoms |
| Agama lizard standing on rock - DPLA - 13e59ee36bac0388b66b6a799d0d2df8.jpg | CC BY-SA 4.0 | lizard |
| Deer in meadow, Ehrenbach.jpg | CC0 | meadow and trees (no deer visible) |

"17 organisms" in the table counts the animals, fungi and the featured
flowers: sunflower, bee, 2 crab spiders, hoverfly, skipper, knapweed, rose,
frog, heron, fish, ladybird, aphids, mushrooms, butterfly, blossoms, lizard.
Box quality was judged by eye from the rendered boxes; this is a smoke test,
not a benchmark. The next step is to run it on real observ.ing photos (the
`species-id-bench` export, see `docs/species-id-benchmark.md` on its branch).

## Findings that shaped the prototype

- **Concrete prompts beat category names.** OWLv2 with the 11 coarse
  prompts (`insect`, `spider`, … `fungus`) missed the bee on the sunflower;
  adding `bee`, `butterfly`, `beetle`, `ladybug`, `mushroom`, `frog`, `lizard`
  and so on, each mapped back to a coarse label, found it. The export script
  has 40 prompts over 12 labels (the 11 asked for plus `mollusc` for snails
  and slugs). A box's score for a label is its best prompt's score.
- **Grounding DINO-style models find more but label worse.** They put all
  prompts in one caption and attribute each box to caption tokens; with 11
  categories that attribution is unreliable. Since the user picks a box and
  `/identify` names the species, labels matter less than recall, which keeps
  MM-Grounding-DINO tiny the main alternative if OWLv2 misses too much on
  real photos. It is ~3× slower, though, and its text side can't be
  precomputed as simply (text and image features are fused in the encoder),
  so the ONNX graph would need the tokenized caption as input, or a fixed one
  baked in.
- **White crab spiders are invisible to OWL.** Every OWL variant except L/14
  either missed them or labelled them insect/fungus. Spiders on flowers are a
  common iNaturalist-style subject, so this is the first thing to check on
  real data.
- **Background vegetation produces many `plant`/`tree` boxes** (lily pads,
  meadow grass, tree crowns). The client will probably want to hide or
  de-emphasise those labels unless nothing else is found, or the service
  could raise the threshold for them.
- **Part boxes.** A hoverfly got three `insect` boxes (whole fly, wings,
  abdomen) that don't overlap enough for NMS to merge. Suppressing a box
  mostly contained in a higher-scoring box of the same label would fix this,
  at the risk of dropping a real small animal on a bigger one of the same
  kind.

## The prototype

`POST /detect` on the species-id service, independent of `/identify`:

```jsonc
// request
{ "image": "<base64>", "minScore": 0.2, "limit": 20 }   // minScore, limit optional
// response
{
  "detections": [
    { "label": "flower", "score": 0.45, "box": { "x": 0.036, "y": 0.089, "width": 0.871, "height": 0.874 } },
    { "label": "insect", "score": 0.20, "box": { "x": 0.455, "y": 0.532, "width": 0.060, "height": 0.046 } }
  ],
  "modelVersion": "owlv2-base-patch16-ensemble-768",
  "inferenceTimeMs": 2537
}
```

Boxes are fractions of the image after its EXIF rotation is applied, the
same convention as `/identify`'s `crop`, so a detection's `box` can be sent
back as the crop. Detections are sorted by score, and a box overlapping a
higher-scoring one by IoU ≥ 0.5 is dropped whatever its label.

- Code: `crates/observing-species-id/src/detector.rs`.
- Model files: `detector.onnx` and `detector_queries.json` in `DETECTOR_DIR`
  (default `models/detector`). Optional; without them `/detect` answers 503
  and the service otherwise behaves as before.
- Export: `uv run crates/observing-species-id/scripts/export_detector.py
  <dir> [--image-size 768] [--int8]`. The ONNX graph is OWLv2's image
  encoder plus its box, class and objectness heads; the text encoder is
  dropped and the prompt embeddings are written to `detector_queries.json`
  and passed in as the `query_embeds` input. Changing prompts only means
  re-running the script; the graph has a dynamic query axis. The graph also
  returns OWLv2's class-agnostic `objectness` per box, unused so far.
- Verified locally against ONNX Runtime 1.27.1 (the NuGet build the
  Dockerfile pins): the service's boxes match the Python reference run, and
  an EXIF-orientation-6 copy of a photo gets the same boxes as the upright
  original.
- Request/response types live in the service's `types.rs` for now. When a
  client is added they should move to `observing-species-id-protocol` and the
  box should become the `CropBox` type from the crop work.

Not done: no Dockerfile/Cloud Run changes (the image would need the ~365 MB
detector, built by the export script or published alongside the BioCLIP
bundle), no Cloud Run latency measurement, no appview or frontend wiring.
