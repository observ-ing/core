# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "transformers>=4.50", "onnx", "onnxruntime"]
# ///
"""Export OWLv2's image side to ONNX for the species-id `/detect` endpoint.

Writes `detector.onnx` and `detector_queries.json` to OUT_DIR, which the
service loads from `DETECTOR_DIR` (default `models/detector`):

    uv run crates/observing-species-id/scripts/export_detector.py models/detector

The text side of OWLv2 is not exported. Each prompt below is embedded once
here and shipped as a row of `detector_queries.json`; the ONNX graph takes
those rows as its `query_embeds` input. Edit PROMPTS and re-run to change what
the detector looks for; the ONNX file does not depend on the prompts.

Graph inputs:  pixel_values [1, 3, S, S]   query_embeds [Q, 512]
Graph outputs: scores [N, Q]  (sigmoid, per patch and prompt)
               boxes [N, 4]   (cx, cy, w, h as fractions of the padded square)
               objectness [N] (sigmoid, class-agnostic "is this an object")

See docs/organism-detection.md for why OWLv2 and these settings.
"""

import argparse
import json
import os

import torch
from transformers import AutoTokenizer, Owlv2ForObjectDetection

# Prompt noun -> label returned by /detect. OWLv2 finds concrete nouns far
# better than abstract ones ("bee" finds the bee on a sunflower that "insect"
# misses), so most labels have several prompts.
PROMPTS = {
    "insect": "insect", "bee": "insect", "butterfly": "insect", "moth": "insect",
    "beetle": "insect", "ladybug": "insect", "fly": "insect", "dragonfly": "insect",
    "ant": "insect", "caterpillar": "insect", "grasshopper": "insect",
    "spider": "spider",
    "flower": "flower",
    "plant": "plant", "leaf": "plant", "moss": "plant", "grass": "plant", "cactus": "plant",
    "tree": "tree",
    "bird": "bird",
    "mammal": "mammal", "deer": "mammal", "squirrel": "mammal", "rabbit": "mammal",
    "fox": "mammal", "rodent": "mammal",
    "reptile": "reptile", "lizard": "reptile", "snake": "reptile", "turtle": "reptile",
    "amphibian": "amphibian", "frog": "amphibian", "toad": "amphibian", "salamander": "amphibian",
    "fish": "fish",
    "fungus": "fungus", "mushroom": "fungus", "lichen": "fungus",
    "snail": "mollusc", "slug": "mollusc",
}


class ImageSide(torch.nn.Module):
    def __init__(self, model, interpolate):
        super().__init__()
        self.m = model
        self.interpolate = interpolate

    def forward(self, pixel_values, query_embeds):
        feature_map, _ = self.m.image_embedder(pixel_values, interpolate_pos_encoding=self.interpolate)
        b, h, w, d = feature_map.shape
        feats = feature_map.reshape(b, h * w, d)
        logits, _ = self.m.class_predictor(feats, query_embeds.unsqueeze(0), None)
        boxes = self.m.box_predictor(feats, feature_map, interpolate_pos_encoding=self.interpolate)
        objectness = self.m.objectness_predictor(feats)
        return logits[0].sigmoid(), boxes[0], objectness[0].sigmoid()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--model", default="google/owlv2-base-patch16-ensemble")
    ap.add_argument("--image-size", type=int, default=768,
                    help="input side in pixels; a multiple of the patch size (16). "
                         "960 is OWLv2's native size; 768 is ~2.5x faster for a small recall loss")
    ap.add_argument("--int8", action="store_true",
                    help="also quantize weights to int8 (detector.onnx becomes ~100 MB)")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    model = Owlv2ForObjectDetection.from_pretrained(args.model).eval()
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    patch = model.config.vision_config.patch_size
    if args.image_size % patch:
        raise SystemExit(f"--image-size must be a multiple of {patch}")
    interpolate = args.image_size != model.config.vision_config.image_size

    nouns = list(PROMPTS)
    texts = [f"a photo of a {n}" for n in nouns]
    with torch.no_grad():
        tok = tokenizer(texts, padding="max_length", max_length=16, return_tensors="pt")
        q = model.owlv2.get_text_features(input_ids=tok.input_ids,
                                          attention_mask=tok.attention_mask).pooler_output
        q = q / q.norm(dim=-1, keepdim=True)

    with open(os.path.join(args.out_dir, "detector_queries.json"), "w") as f:
        json.dump({
            "model": args.model,
            "image_size": args.image_size,
            "queries": [{"prompt": t, "label": PROMPTS[n], "embedding": [round(x, 6) for x in e.tolist()]}
                        for n, t, e in zip(nouns, texts, q)],
        }, f)

    path = os.path.join(args.out_dir, "detector.onnx")
    fp32_path = path + ".fp32" if args.int8 else path
    torch.onnx.export(
        ImageSide(model, interpolate), (torch.zeros(1, 3, args.image_size, args.image_size), q),
        fp32_path, dynamo=False, opset_version=17,
        input_names=["pixel_values", "query_embeds"],
        output_names=["scores", "boxes", "objectness"],
        dynamic_axes={"query_embeds": {0: "q"}, "scores": {1: "q"}},
    )
    if args.int8:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        quantize_dynamic(fp32_path, path, weight_type=QuantType.QInt8,
                         op_types_to_quantize=["MatMul", "Gemm"])
        os.remove(fp32_path)
    print(f"wrote {path} ({os.path.getsize(path) / 1e6:.0f} MB) and detector_queries.json "
          f"({len(texts)} prompts)")


if __name__ == "__main__":
    main()
