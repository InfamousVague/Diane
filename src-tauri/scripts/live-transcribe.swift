#!/usr/bin/env swift
// Live transcription server — reads audio from stdin, outputs transcript lines to stdout
// Usage: pipe raw 16-bit 16kHz mono PCM audio to stdin
// Each line of stdout is the latest transcript update

import Speech
import Foundation
import AVFoundation

// Request authorization synchronously
let authSemaphore = DispatchSemaphore(value: 0)
var authorized = false
SFSpeechRecognizer.requestAuthorization { status in
    authorized = (status == .authorized)
    authSemaphore.signal()
}
authSemaphore.wait()

guard authorized else {
    fputs("ERROR: Speech recognition not authorized\n", stderr)
    exit(1)
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
    fputs("ERROR: Speech recognizer not available\n", stderr)
    exit(1)
}

let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true

var lastTranscript = ""

let task = recognizer.recognitionTask(with: request) { result, error in
    if let result = result {
        let text = result.bestTranscription.formattedString
        if text != lastTranscript {
            lastTranscript = text
            print(text)
            fflush(stdout)
        }
        if result.isFinal {
            print("FINAL:" + text)
            fflush(stdout)
        }
    }
    if let error = error {
        fputs("ERROR: \(error.localizedDescription)\n", stderr)
    }
}

// Read raw PCM audio from stdin and feed to recognizer
let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
let bufferSize: AVAudioFrameCount = 4096

DispatchQueue.global(qos: .userInitiated).async {
    let stdinHandle = FileHandle.standardInput
    while true {
        let data = stdinHandle.availableData
        if data.isEmpty {
            // stdin closed — finalize
            request.endAudio()
            break
        }

        let frameCount = AVAudioFrameCount(data.count / 2) // 16-bit = 2 bytes per sample
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { continue }
        buffer.frameLength = frameCount

        data.withUnsafeBytes { rawPtr in
            guard let src = rawPtr.baseAddress else { return }
            memcpy(buffer.int16ChannelData![0], src, data.count)
        }

        request.append(buffer)
    }
}

// Keep running until the recognition task finishes
RunLoop.main.run(until: Date.distantFuture)
