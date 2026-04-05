#!/usr/bin/env python3
"""
Diane TTS — Synthesize speech in Dale Cooper's cloned voice using XTTS-v2.

Uses pre-extracted speaker latents (cooper_speaker.pth) for fast synthesis
without needing to process the reference audio each time.

Prints STATUS: lines to stdout for the Rust backend to parse.
"""

import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref", required=True, help="Path to voice reference WAV (fallback)")
    parser.add_argument("--out", required=True, help="Output WAV path")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--model-dir", default=None, help="Path to bundled XTTS-v2 model directory")
    args = parser.parse_args()

    sys.stdout.write("STATUS:loading\n")
    sys.stdout.flush()

    os.environ["COQUI_TOS_AGREED"] = "1"

    import torch
    _original_load = torch.load
    torch.load = lambda *a, **kw: _original_load(*a, **{**kw, "weights_only": False})

    model_dir = args.model_dir
    speaker_pth = os.path.join(model_dir, "cooper_speaker.pth") if model_dir else None

    if model_dir and os.path.isdir(model_dir) and speaker_pth and os.path.exists(speaker_pth):
        # Fast path: load model + pre-computed speaker latents directly
        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts

        config = XttsConfig()
        config.load_json(os.path.join(model_dir, "config.json"))
        model = Xtts.init_from_config(config)
        model.load_checkpoint(config, checkpoint_dir=model_dir, eval=True)

        # Load pre-computed speaker latents
        speaker_data = torch.load(speaker_pth)
        gpt_cond_latent = speaker_data["gpt_cond_latent"]
        speaker_embedding = speaker_data["speaker_embedding"]

        sys.stdout.write("STATUS:synthesizing\n")
        sys.stdout.flush()

        # Synthesize directly with pre-computed latents
        out = model.inference(
            text=args.text,
            language="en",
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
        )

        # Save as WAV
        import torchaudio
        wav = torch.tensor(out["wav"]).unsqueeze(0)
        torchaudio.save(args.out, wav, 24000)
    else:
        # Slow fallback: process reference audio each time
        from TTS.api import TTS

        if model_dir and os.path.isdir(model_dir):
            config_path = os.path.join(model_dir, "config.json")
            tts = TTS()
            tts.load_tts_model_by_path(
                model_path=model_dir,
                config_path=config_path,
                gpu=False,
            )
        else:
            tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=False)

        sys.stdout.write("STATUS:synthesizing\n")
        sys.stdout.flush()

        tts.tts_to_file(
            text=args.text,
            speaker_wav=args.ref,
            language="en",
            file_path=args.out,
        )

    sys.stdout.write("STATUS:done\n")
    sys.stdout.flush()

    # Force exit — torch/TTS sometimes hangs on cleanup
    os._exit(0)


if __name__ == "__main__":
    main()
