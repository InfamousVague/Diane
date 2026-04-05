#!/usr/bin/env python3
"""
Diane Audio Event Detector — Classifies environmental sounds using
HuggingFace Audio Spectrogram Transformer (AST).

Reads raw 16-bit 16kHz mono PCM from stdin in 2-second chunks.
Outputs EVENT:<timestamp_ms>:<label>:<confidence> lines to stdout.
"""

import os
import sys
import struct
import time

# Friendly name mapping for common AudioSet labels
FRIENDLY_NAMES = {
    "Chirp, tweet": "birds chirping",
    "Bird vocalization, bird call, bird song": "birds singing",
    "Bird": "bird sounds",
    "Music": "music",
    "Speech": None,  # exclude
    "Silence": None,  # exclude
    "Inside, small room": None,  # too generic
    "Outside, urban or manmade": None,  # too generic
    "Outside, rural or natural": None,  # too generic
    "Narration, monologue": None,  # that's just speaking
    "Conversation": None,
    "Male speech, man speaking": None,
    "Female speech, woman speaking": None,
    "Door": "door",
    "Slam": "slam",
    "Knock": "knocking",
    "Tap": "tapping",
    "Clapping": "clapping",
    "Laughter": "laughter",
    "Crying, sobbing": "crying",
    "Sigh": "sigh",
    "Cough": "cough",
    "Sneeze": "sneeze",
    "Breathing": "breathing",
    "Footsteps": "footsteps",
    "Rain": "rain",
    "Thunder": "thunder",
    "Wind": "wind",
    "Water": "water",
    "Dog": "dog barking",
    "Cat": "cat meowing",
    "Engine": "engine",
    "Car": "car",
    "Siren": "siren",
    "Alarm": "alarm",
    "Bell": "bell",
    "Telephone": "phone ringing",
    "Typing": "typing",
    "Writing": "writing",
    "Applause": "applause",
    "Explosion": "explosion",
    "Gunshot, gunfire": "gunshot",
    "Glass": "glass breaking",
    "Screaming": "screaming",
    "Whistle": "whistle",
    "Musical instrument": "instrument playing",
    "Piano": "piano",
    "Guitar": "guitar",
    "Drum": "drums",
    "Singing": "singing",
    "Humming": "humming",
    "Whistling": "whistling",
    "Snoring": "snoring",
    "Crowd": "crowd noise",
    "Chewing, mastication": "chewing",
    "Crumpling, crinkling": "paper crinkling",
    "Shatter": "shattering",
    "Squeak": "squeaking",
    "Buzz": "buzzing",
    "Click": "clicking",
    "Beep, bleep": "beeping",
    "Static": "static noise",
    "Hiss": "hissing",
    "Whoosh, swoosh, swish": "whoosh",
    "Thump, thud": "thud",
    "Crack": "cracking",
    "Rustle": "rustling",
    "Zipper (clothing)": "zipper",
    "Keys jangling": "keys jangling",
    "Coin (dropping)": "coin dropping",
    "Scissors": "scissors",
    "Microwave oven": "microwave",
    "Boiling": "boiling",
    "Frying (food)": "frying",
    "Toilet flush": "toilet flushing",
    "Fire": "fire crackling",
    "Fireworks": "fireworks",
    "Helicopter": "helicopter",
    "Airplane": "airplane",
    "Train": "train",
}

# Minimum confidence to report an event
MIN_CONFIDENCE = 0.3

# Chunk size: 2 seconds at 16kHz mono 16-bit = 64000 bytes
CHUNK_SAMPLES = 32000
CHUNK_BYTES = CHUNK_SAMPLES * 2  # 16-bit = 2 bytes per sample
SAMPLE_RATE = 16000


def get_friendly_name(label):
    """Map AudioSet label to a friendly name, or lowercase the original."""
    if label in FRIENDLY_NAMES:
        return FRIENDLY_NAMES[label]
    # For unmapped labels, lowercase and clean up
    clean = label.lower().strip()
    if clean in ("speech", "silence", "noise"):
        return None
    return clean


def main():
    sys.stdout.write("STATUS:loading\n")
    sys.stdout.flush()

    os.environ["TOKENIZERS_PARALLELISM"] = "false"

    import torch
    _orig = torch.load
    torch.load = lambda *a, **kw: _orig(*a, **{**kw, "weights_only": False})

    from transformers import AutoFeatureExtractor, ASTForAudioClassification

    model_name = "MIT/ast-finetuned-audioset-10-10-0.4593"
    feature_extractor = AutoFeatureExtractor.from_pretrained(model_name)
    model = ASTForAudioClassification.from_pretrained(model_name)
    model.eval()

    sys.stdout.write("STATUS:ready\n")
    sys.stdout.flush()

    elapsed_ms = 0
    stdin = sys.stdin.buffer

    while True:
        # Read a 2-second chunk of 16-bit PCM
        raw = b""
        while len(raw) < CHUNK_BYTES:
            chunk = stdin.read(CHUNK_BYTES - len(raw))
            if not chunk:
                # stdin closed
                sys.exit(0)
            raw += chunk

        # Convert to float32 [-1, 1]
        n_samples = len(raw) // 2
        samples = struct.unpack(f"<{n_samples}h", raw)
        audio = [s / 32768.0 for s in samples]

        # Classify
        try:
            inputs = feature_extractor(
                audio,
                sampling_rate=SAMPLE_RATE,
                return_tensors="pt",
            )

            with torch.no_grad():
                logits = model(**inputs).logits

            probs = torch.nn.functional.softmax(logits, dim=-1)[0]
            top_indices = torch.argsort(probs, descending=True)[:5]

            for idx in top_indices:
                confidence = probs[idx].item()
                if confidence < MIN_CONFIDENCE:
                    break

                label = model.config.id2label[idx.item()]
                friendly = get_friendly_name(label)

                if friendly is None:
                    continue

                sys.stdout.write(f"EVENT:{elapsed_ms}:{friendly}:{confidence:.3f}\n")
                sys.stdout.flush()

        except Exception as e:
            sys.stderr.write(f"Classification error: {e}\n")
            sys.stderr.flush()

        elapsed_ms += int(n_samples * 1000 / SAMPLE_RATE)


if __name__ == "__main__":
    main()
