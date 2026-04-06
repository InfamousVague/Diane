import Foundation
import ScreenCaptureKit
import CoreMedia
import AVFoundation

/// Captures system audio output via ScreenCaptureKit and writes raw PCM float32 to stdout.
/// Protocol: prints STATUS: lines, writes binary PCM to stdout.

class AudioCapturer: NSObject, SCStreamOutput {
    var stream: SCStream?
    let outputHandle = FileHandle.standardOutput

    func start() async {
        // Print ready status
        fputs("STATUS:ready\n", stderr)
        fflush(stderr)

        do {
            // Get shareable content
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            guard let display = content.displays.first else {
                fputs("STATUS:error:no_display\n", stderr)
                return
            }

            // Configure audio-only capture
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 48000
            config.channelCount = 1

            // Minimize video capture (we only want audio)
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1) // 1 fps minimum

            let stream = SCStream(filter: filter, configuration: config, delegate: nil)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInteractive))
            try await stream.startCapture()

            self.stream = stream
            fputs("STATUS:capturing\n", stderr)
            fflush(stderr)

        } catch {
            let desc = error.localizedDescription
            if desc.contains("permission") || desc.contains("denied") || desc.contains("TCCDeny") {
                fputs("STATUS:permission_denied\n", stderr)
            } else {
                fputs("STATUS:error:\(desc)\n", stderr)
            }
            fflush(stderr)
        }
    }

    func stop() {
        if let stream = stream {
            stream.stopCapture { error in
                if let error = error {
                    fputs("STATUS:error:\(error.localizedDescription)\n", stderr)
                    fflush(stderr)
                }
            }
        }
    }

    // SCStreamOutput delegate — receives audio sample buffers
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }

        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }

        var lengthAtOffset: Int = 0
        var totalLength: Int = 0
        var dataPointer: UnsafeMutablePointer<Int8>?

        let status = CMBlockBufferGetDataPointer(
            blockBuffer,
            atOffset: 0,
            lengthAtOffsetOut: &lengthAtOffset,
            totalLengthOut: &totalLength,
            dataPointerOut: &dataPointer
        )

        guard status == noErr, let ptr = dataPointer else { return }

        // Audio arrives as float32 PCM at 48kHz mono
        let data = Data(bytes: ptr, count: totalLength)
        outputHandle.write(data)
    }
}

// Main
let capturer = AudioCapturer()

// Start capture
Task {
    await capturer.start()
}

// Keep running until stdin closes or receives STOP
let inputHandle = FileHandle.standardInput
while true {
    let data = inputHandle.availableData
    if data.isEmpty {
        break // stdin closed
    }
    if let cmd = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
        if cmd == "STOP" {
            break
        }
    }
}

capturer.stop()
exit(0)
