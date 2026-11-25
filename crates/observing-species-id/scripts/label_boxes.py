# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "transformers>=4.50", "onnxruntime", "numpy", "pillow"]
# ///
"""Taxon-guided box labeler prototype (see docs/organism-detection.md).

Every observ.ing photo comes with the taxon the observer identified. Instead
of open-ended detection, ask a big open-vocabulary detector (OWLv2-L) for
boxes of that taxon's coarse group, then let BioCLIP pick the box whose crop
looks most like that taxon.

  label_boxes.py detect <export-dir>   OWLv2-L on every image -> candidates.json
  label_boxes.py verify <export-dir>   BioCLIP on the full image + each candidate -> verified.json
  label_boxes.py select <export-dir>   choose a box per photo, flag other organisms -> labels.jsonl + sheets

<export-dir> is a `species-id-bench export` directory (samples.jsonl + images/).
BIOCLIP_DIR points at a BioCLIP bundle (vision_encoder.onnx, species_embeddings.bin,
species_labels.json); default models/bioclip. Uses CUDA, then Apple MPS, then CPU.
"""

import json
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
BIOCLIP = os.environ.get("BIOCLIP_DIR", "models/bioclip")

# Prompts for "anything else that is alive", used to flag photos with other organisms.
OTHER = {
    "insect": "insect", "bee": "insect", "butterfly": "insect", "moth": "insect", "beetle": "insect",
    "fly": "insect", "dragonfly": "insect", "ant": "insect", "caterpillar": "insect",
    "spider": "spider", "flower": "flower", "bird": "bird", "mammal": "mammal", "lizard": "reptile",
    "snake": "reptile", "turtle": "reptile", "frog": "amphibian", "fish": "fish",
    "mushroom": "fungus", "snail": "mollusc", "slug": "mollusc",
}

INSECT_ORDERS = {
    "Lepidoptera": ["butterfly", "moth", "caterpillar"],
    "Coleoptera": ["beetle", "ladybug"],
    "Hymenoptera": ["bee", "wasp", "ant"],
    "Diptera": ["fly"],
    "Odonata": ["dragonfly", "damselfly"],
    "Hemiptera": ["bug", "cicada", "aphid"],
    "Orthoptera": ["grasshopper", "cricket"],
    "Mantodea": ["mantis"],
}


def group_for(t):
    """Coarse group and detector prompts for an observation's taxon."""
    k, c, o = t.get("kingdom"), t.get("class"), t.get("order")
    if c == "Insecta":
        return "insect", ["insect"] + INSECT_ORDERS.get(o, [])
    if c == "Arachnida":
        return "spider", ["spider"]
    if c == "Aves":
        return "bird", ["bird"]
    if c == "Gastropoda":
        return "mollusc", ["snail", "slug"]
    if c == "Mammalia":
        return "mammal", ["mammal", "animal"]
    if c in ("Squamata", "Testudines", "Reptilia", "Crocodylia"):
        return "reptile", ["lizard", "snake", "turtle"]
    if c == "Amphibia":
        return "amphibian", ["frog", "toad", "salamander"]
    if k == "Fungi":
        return "fungus", ["mushroom", "fungus", "lichen"]
    if k == "Plantae":
        if c in ("Bryopsida", "Jungermanniopsida", "Marchantiopsida"):
            return "plant", ["moss", "plant"]
        return "plant", ["flower", "plant", "leaf", "tree"]
    return "other", ["animal"]


def samples(d):
    return [json.loads(l) for l in open(os.path.join(d, "samples.jsonl"))]


def load_image(d, s):
    return ImageOps.exif_transpose(Image.open(os.path.join(d, s["image"]))).convert("RGB")


def iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0


def nms(items, thr=0.5, k=8):
    out = []
    for it in sorted(items, key=lambda x: -x["score"]):
        if all(iou(it["box"], o["box"]) < thr for o in out):
            out.append(it)
        if len(out) == k:
            break
    return out


def detect(d):
    import torch
    from transformers import Owlv2ForObjectDetection, Owlv2Processor
    dev = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    mid = "google/owlv2-large-patch14-ensemble"
    proc = Owlv2Processor.from_pretrained(mid)
    model = Owlv2ForObjectDetection.from_pretrained(mid).eval().to(dev)
    out, t0 = {}, time.time()
    for i, s in enumerate(samples(d)):
        group, target = group_for(s["taxon"])
        others = [p for p in OTHER if p not in target]
        texts = target + others
        img = load_image(d, s)
        inputs = proc(text=[[f"a photo of a {p}" for p in texts]], images=img, return_tensors="pt").to(dev)
        with torch.no_grad():
            o = model(**inputs)
        logits = o.logits[0].sigmoid().cpu().numpy()            # [patches, prompts]
        boxes = o.pred_boxes[0].cpu().numpy()                    # cxcywh, padded square
        W, H = img.size
        side = max(W, H)
        sx, sy = side / W, side / H

        def frac(b):
            cx, cy, w, h = b
            r = [max(0, (cx - w / 2) * sx), max(0, (cy - h / 2) * sy),
                 min(1, (cx + w / 2) * sx), min(1, (cy + h / 2) * sy)]
            return r if r[2] > r[0] and r[3] > r[1] else None

        nt = len(target)
        tscore = logits[:, :nt].max(1)
        cands = [{"box": frac(boxes[j]), "score": float(tscore[j]), "prompt": target[int(logits[j, :nt].argmax())]}
                 for j in np.argsort(-tscore)[:200] if tscore[j] >= 0.02 and frac(boxes[j])]
        oscore = logits[:, nt:].max(1)
        other = [{"box": frac(boxes[j]), "score": float(oscore[j]),
                  "prompt": others[int(logits[j, nt:].argmax())]}
                 for j in np.argsort(-oscore)[:100] if oscore[j] >= 0.15 and frac(boxes[j])]
        out[s["id"]] = {"group": group, "targets": target, "candidates": nms(cands, 0.5, 6),
                        "others": nms(other, 0.5, 10), "size": [W, H]}
        if i % 10 == 0:
            print(f"{i} {s['id']} {group} best {out[s['id']]['candidates'][:1]} {time.time() - t0:.0f}s", flush=True)
    json.dump(out, open(os.path.join(d, "candidates.json"), "w"))
    print(f"detect: {len(out)} photos in {time.time() - t0:.0f}s")


class BioClip:
    MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
    STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

    def __init__(self):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = 6
        providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
                     if p in ort.get_available_providers()]
        self.sess = ort.InferenceSession(os.path.join(BIOCLIP, "vision_encoder.onnx"), so, providers=providers)
        self.labels = json.load(open(os.path.join(BIOCLIP, "species_labels.json")))
        n = len(self.labels)
        self.emb = np.fromfile(os.path.join(BIOCLIP, "species_embeddings.bin"), dtype="<f4").reshape(n, -1)
        self.cols = {r: np.array([(l.get(r) or "") for l in self.labels])
                     for r in ("genus", "family", "order", "class")}
        self.sci = np.array([l["scientificName"] for l in self.labels])

    def embed(self, img):
        x = np.asarray(img.resize((224, 224), Image.BICUBIC), dtype=np.float32) / 255.0
        x = ((x - self.MEAN) / self.STD).transpose(2, 0, 1)[None]
        e = self.sess.run(None, {"pixel_values": x})[0][0]
        return e / np.linalg.norm(e)

    def match_mask(self, t):
        """Species rows that fall inside the observation's taxon."""
        if t["rank"] == "species":
            return self.sci == t["scientificName"]
        if t["rank"] in self.cols:
            return self.cols[t["rank"]] == t["scientificName"]
        return np.zeros(len(self.sci), bool)

    def family_mask(self, t):
        return self.cols["family"] == (t.get("family") or "-")

    def score(self, img, mask, fam):
        sims = self.emb @ self.embed(img)
        p = np.exp((sims - sims.max()) * 100.0)
        p /= p.sum()
        top = np.argsort(-sims)[:5]
        return {"mass": float(p[mask].sum()), "familyMass": float(p[fam].sum()),
                "top1": bool(mask[top[0]]), "top5": bool(mask[top].any()),
                "top": [str(self.sci[i]) for i in top[:3]]}


def crop(img, b, pad=0.1):
    W, H = img.size
    w, h = (b[2] - b[0]) * W, (b[3] - b[1]) * H
    p = pad * max(w, h)
    return img.crop((max(0, b[0] * W - p), max(0, b[1] * H - p), min(W, b[2] * W + p), min(H, b[3] * H + p)))


def verify(d):
    bc = BioClip()
    cand = json.load(open(os.path.join(d, "candidates.json")))
    out, t0 = {}, time.time()
    for i, s in enumerate(samples(d)):
        c = cand[s["id"]]
        mask, fam = bc.match_mask(s["taxon"]), bc.family_mask(s["taxon"])
        img = load_image(d, s)
        r = {"inLabels": bool(mask.any()), "full": bc.score(img, mask, fam), "candidates": []}
        for k in c["candidates"]:
            r["candidates"].append({**k, "bioclip": bc.score(crop(img, k["box"]), mask, fam)})
        out[s["id"]] = r
        if i % 20 == 0:
            print(f"{i} {s['taxon']['scientificName']} full {r['full']['mass']:.2f} "
                  f"best crop {max([x['bioclip']['mass'] for x in r['candidates']] or [0]):.2f} {time.time() - t0:.0f}s",
                  flush=True)
    json.dump(out, open(os.path.join(d, "verified.json"), "w"))
    print(f"verify: {len(out)} photos in {time.time() - t0:.0f}s")


def select(d):
    cand = json.load(open(os.path.join(d, "candidates.json")))
    ver = json.load(open(os.path.join(d, "verified.json")))
    rows = []
    for s in samples(d):
        c, v = cand[s["id"]], ver[s["id"]]
        cs = v["candidates"]
        status, best = "no-candidate", None
        if cs:
            # Prefer the crop BioCLIP thinks is most like the observed taxon; break near-ties by detector score.
            best = max(cs, key=lambda k: (round(k["bioclip"]["mass"], 2), round(k["bioclip"]["familyMass"], 1),
                                          k["score"]))
            full = v["full"]["mass"]
            m = best["bioclip"]["mass"]
            if not v["inLabels"]:
                status = "taxon-not-in-bioclip"
            elif m >= 0.2 or best["bioclip"]["top5"] or best["bioclip"]["familyMass"] >= 0.5 \
                    or (m >= 0.05 and m >= 0.8 * full):
                status = "accepted"
            else:
                status = "rejected"
        others = []
        if best:
            others = [o for o in c["others"] if o["score"] >= 0.3 and iou(o["box"], best["box"]) < 0.3
                      and not (o["box"][0] >= best["box"][0] - .02 and o["box"][2] <= best["box"][2] + .02
                               and o["box"][1] >= best["box"][1] - .02 and o["box"][3] <= best["box"][3] + .02)]
        rows.append({"id": s["id"], "taxon": s["taxon"]["scientificName"], "rank": s["taxon"]["rank"],
                     "group": c["group"], "status": status, "box": best and best["box"],
                     "detScore": best and best["score"], "prompt": best and best["prompt"],
                     "bioclipCrop": best and best["bioclip"], "bioclipFull": v["full"],
                     "nCandidates": len(cs), "otherOrganisms": others})
    with open(os.path.join(d, "labels.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    from collections import Counter
    print(Counter(r["status"] for r in rows))
    print("by group:", {g: dict(Counter(r["status"] for r in rows if r["group"] == g))
                        for g in sorted({r["group"] for r in rows})})
    print("with other organisms flagged:", sum(1 for r in rows if r["otherOrganisms"]))
    render(d, rows, cand)


def render(d, rows, cand):
    """Contact sheets: chosen box (green accepted / red rejected), other candidates thin grey."""
    os.makedirs(os.path.join(d, "sheets"), exist_ok=True)
    by_id = {s["id"]: s for s in samples(d)}
    CW, per = 360, 24
    for n in range(0, len(rows), per):
        chunk = rows[n:n + per]
        sheet = Image.new("RGB", (CW * 6, (CW + 50) * 4), "white")
        for i, r in enumerate(chunk):
            img = load_image(d, by_id[r["id"]])
            img.thumbnail((CW, CW))
            dr = ImageDraw.Draw(img)
            W, H = img.size
            for k in cand[r["id"]]["candidates"]:
                b = k["box"]
                dr.rectangle([b[0] * W, b[1] * H, b[2] * W, b[3] * H], outline=(160, 160, 160), width=1)
            for o in r["otherOrganisms"]:
                b = o["box"]
                dr.rectangle([b[0] * W, b[1] * H, b[2] * W, b[3] * H], outline="orange", width=2)
            if r["box"]:
                b = r["box"]
                col = "lime" if r["status"] == "accepted" else "red"
                dr.rectangle([b[0] * W, b[1] * H, b[2] * W, b[3] * H], outline=col, width=4)
            x, y = (i % 6) * CW, (i // 6) * (CW + 50)
            sheet.paste(img, (x, y))
            sd = ImageDraw.Draw(sheet)
            mass = r["bioclipCrop"]["mass"] if r["bioclipCrop"] else 0
            sd.text((x + 4, y + CW + 2), f"{n + i} {r['taxon'][:30]}", fill="black", font_size=15)
            sd.text((x + 4, y + CW + 20), f"{r['status']} {r['prompt'] or ''} det {r['detScore'] or 0:.2f} "
                    f"bc {mass:.2f}/{r['bioclipFull']['mass']:.2f}", fill="black", font_size=13)
        sheet.save(os.path.join(d, "sheets", f"sheet-{n // per:02d}.jpg"), quality=80)


if __name__ == "__main__":
    {"detect": detect, "verify": verify, "select": select}[sys.argv[1]](sys.argv[2])
