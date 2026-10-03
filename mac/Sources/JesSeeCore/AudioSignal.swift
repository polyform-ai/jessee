import AVFoundation
import Accelerate
import Foundation

/// Reads the actual PCM representation, including interleaved and integer input devices.
public enum AudioSignal {
  public static func rms(in buffer: CMSampleBuffer) -> Double? {
    guard buffer.isValid,
      let format = buffer.formatDescription?.audioStreamBasicDescription,
      format.mFormatID == kAudioFormatLinearPCM
    else { return nil }
    var sum: Double = 0
    var count = 0
    try? buffer.withAudioBufferList { list, _ in
      for item in list {
        guard let data = item.mData else { continue }
        if format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 32 {
          let length = Int(item.mDataByteSize) / MemoryLayout<Float>.size
          guard length > 0 else { continue }
          var mean: Float = 0
          vDSP_measqv(data.assumingMemoryBound(to: Float.self), 1, &mean, vDSP_Length(length))
          sum += Double(mean) * Double(length)
          count += length
        } else if format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 64 {
          let values = UnsafeBufferPointer(
            start: data.assumingMemoryBound(to: Double.self),
            count: Int(item.mDataByteSize) / MemoryLayout<Double>.size)
          for sample in values { sum += sample * sample }
          count += values.count
        } else if format.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0,
          format.mBitsPerChannel == 32
        {
          let values = UnsafeBufferPointer(
            start: data.assumingMemoryBound(to: Int32.self),
            count: Int(item.mDataByteSize) / MemoryLayout<Int32>.size)
          for value in values {
            let sample = Double(value) / 2147483648
            sum += sample * sample
          }
          count += values.count
        } else if format.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0,
          format.mBitsPerChannel == 16
        {
          let values = UnsafeBufferPointer(
            start: data.assumingMemoryBound(to: Int16.self),
            count: Int(item.mDataByteSize) / MemoryLayout<Int16>.size)
          for value in values {
            let sample = Double(value) / 32768
            sum += sample * sample
          }
          count += values.count
        }
      }
    }
    guard count > 0, sum.isFinite else { return nil }
    return sqrt(sum / Double(count))
  }

  /// Reject a silent *track*, not just a missing track, before any paid AI request.
  public static func requireSignal(in url: URL) async throws {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
      throw JesSeeError.mediaHasNoAudio
    }
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsNonInterleaved: false,
      ])
    reader.add(output)
    guard reader.startReading() else {
      throw reader.error ?? JesSeeError.invalidResponse("JesSee could not check the audio.")
    }
    defer { reader.cancelReading() }
    while let buffer = output.copyNextSampleBuffer() {
      try Task.checkCancellation()
      // A very low floor rejects digital silence without discarding softly spoken narration.
      if let level = rms(in: buffer), level > 0.00001 { return }
    }
    if reader.status == .failed {
      throw reader.error ?? JesSeeError.invalidResponse("JesSee could not read the audio.")
    }
    throw JesSeeError.mediaHasSilentAudio
  }
}
