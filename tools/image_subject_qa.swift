// 头像构图体检：人脸框 + 视觉显著性主体框。
//
// 用途：出头像/特写类图后，量化「脸是不是画面主体、有没有居中」，
// 不依赖肉眼。face 框来自 Vision 人脸检测（卡通角色可能检不到，属正常），
// saliency 框是 attention-based 显著性热区，检不到脸时用它兜底判断主体位置。
//
// 编译：swiftc -O -o tools/image_subject_qa tools/image_subject_qa.swift
// 用法：tools/image_subject_qa <图片...>   （输出 JSON 行，坐标为归一化、原点左下）
import AppKit
import Foundation
import Vision

func bboxJSON(_ r: CGRect, _ w: Int, _ h: Int) -> [String: Any] {
    let cx = r.midX - 0.5, cy = r.midY - 0.5  // Vision 原点在左下，+y 向上
    return [
        "x": r.minX, "y": r.minY, "w": r.width, "h": r.height,
        "cx_offset_pct": cx * 100, "cy_offset_up_pct": cy * 100,
        "w_pct": r.width * 100, "h_pct": r.height * 100,
        "area_pct": r.width * r.height * 100,
        "pixel_box": ["x": Int(r.minX * Double(w)), "y": Int((1 - r.maxY) * Double(h)),
                      "w": Int(r.width * Double(w)), "h": Int(r.height * Double(h))],
    ]
}

func heatmapBox(_ buffer: CVPixelBuffer) -> CGRect? {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    var minX = w, minY = h, maxX = -1, maxY = -1, hits = 0
    for y in 0..<h {
        let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self)
        for x in 0..<w where row[x] > 0.5 {
            hits += 1
            minX = min(minX, x); maxX = max(maxX, x)
            minY = min(minY, y); maxY = max(maxY, y)
        }
    }
    guard hits > 0 else { return nil }
    return CGRect(x: Double(minX) / Double(w), y: Double(minY) / Double(h),
                  width: Double(maxX - minX + 1) / Double(w),
                  height: Double(maxY - minY + 1) / Double(h))
}

var results: [[String: Any]] = []
for path in CommandLine.arguments.dropFirst() {
    var entry: [String: Any] = ["file": (path as NSString).lastPathComponent]
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        entry["error"] = "unreadable"
        results.append(entry); continue
    }
    let w = cg.width, h = cg.height
    entry["size"] = [w, h]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    let faces = VNDetectFaceRectanglesRequest()
    let saliency = VNGenerateAttentionBasedSaliencyImageRequest()
    do { try handler.perform([faces, saliency]) } catch {
        entry["error"] = "vision failed: \(error)"
        results.append(entry); continue
    }
    entry["faces"] = (faces.results ?? []).map { bboxJSON($0.boundingBox, w, h) }
    if let obs = saliency.results?.first {
        if let objects = obs.salientObjects, !objects.isEmpty {
            entry["salient"] = objects.map { bboxJSON($0.boundingBox, w, h) }
        } else if let box = heatmapBox(obs.pixelBuffer) {
            entry["salient"] = [bboxJSON(box, w, h)]
        } else {
            entry["salient"] = []
        }
    }
    results.append(entry)
}

let data = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
print("")
