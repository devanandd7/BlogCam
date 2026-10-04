package com.cam2;

import android.graphics.ImageFormat;
import android.media.Image;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.mrousavy.camera.frameprocessors.Frame;
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin;
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry;
import com.mrousavy.camera.core.types.Orientation;

import com.oney.WebRTCModule.ExternalVideoCapturer;
import org.webrtc.JavaI420Buffer;
import org.webrtc.VideoFrame;

import java.nio.ByteBuffer;
import java.util.Map;

import android.util.Log;

public final class BlogCamWebRtcFrameProcessorPlugin extends FrameProcessorPlugin {
  private static final String TAG = "BlogCamWebRtc";

  public static void register() {
    FrameProcessorPluginRegistry.addFrameProcessorPlugin(
        "blogcamWebRtc",
        (proxy, options) -> new BlogCamWebRtcFrameProcessorPlugin()
    );
  }

  @Nullable
  @Override
  public Object callback(
      @NonNull Frame frame,
      @Nullable Map<String, Object> params
  ) {
    if (!ExternalVideoCapturer.isStreaming()) {
      return null;
    }

    try {
      Image image = frame.getImage();
      if (image == null || image.getFormat() != ImageFormat.YUV_420_888 || image.getPlanes().length < 3) {
        return null;
      }

      Image.Plane[] planes = image.getPlanes();
      int width = frame.getWidth();
      int height = frame.getHeight();
      int chromaWidth = (width + 1) / 2;
      int chromaHeight = (height + 1) / 2;

      JavaI420Buffer buffer = JavaI420Buffer.allocate(width, height);
      VideoFrame videoFrame = null;
      try {
        copyPlane(planes[0], width, height, buffer.getDataY(), buffer.getStrideY());
        copyPlane(planes[1], chromaWidth, chromaHeight, buffer.getDataU(), buffer.getStrideU());
        copyPlane(planes[2], chromaWidth, chromaHeight, buffer.getDataV(), buffer.getStrideV());

        int rotation = toRotationDegrees(frame.getOrientation());

        videoFrame = new VideoFrame(
            buffer,
            rotation,
            frame.getTimestamp()
        );
        ExternalVideoCapturer.publish(videoFrame);
      } finally {
        if (videoFrame != null) {
          videoFrame.release();
        } else {
          buffer.release();
        }
      }
    } catch (Throwable error) {
      Log.w(TAG, "Frame processing skipped: " + error.getMessage());
    }
    return null;
  }

  private static int toRotationDegrees(Orientation orientation) {
    switch (orientation) {
      case LANDSCAPE_RIGHT:
        return 90;
      case PORTRAIT_UPSIDE_DOWN:
        return 180;
      case LANDSCAPE_LEFT:
        return 270;
      case PORTRAIT:
      default:
        return 0;
    }
  }

  private static void copyPlane(
      Image.Plane plane,
      int width,
      int height,
      ByteBuffer destination,
      int destinationStride
  ) {
    ByteBuffer source = plane.getBuffer();
    int sourcePosition = source.position();
    int rowStride = plane.getRowStride();
    int pixelStride = plane.getPixelStride();

    if (pixelStride == 1 && rowStride == destinationStride && destinationStride == width) {
      source.position(sourcePosition);
      int length = width * height;
      int originalLimit = source.limit();
      source.limit(sourcePosition + length);
      destination.position(0);
      destination.put(source);
      source.limit(originalLimit);
      destination.position(0);
      return;
    }

    if (pixelStride == 1) {
      byte[] rowBuffer = new byte[width];
      for (int row = 0; row < height; row++) {
        source.position(sourcePosition + row * rowStride);
        source.get(rowBuffer, 0, width);
        destination.position(row * destinationStride);
        destination.put(rowBuffer, 0, width);
      }
      destination.position(0);
      return;
    }

    byte[] rowBuffer = new byte[(width - 1) * pixelStride + 1];
    byte[] outRow = new byte[width];
    for (int row = 0; row < height; row++) {
      source.position(sourcePosition + row * rowStride);
      source.get(rowBuffer, 0, rowBuffer.length);
      for (int col = 0; col < width; col++) {
        outRow[col] = rowBuffer[col * pixelStride];
      }
      destination.position(row * destinationStride);
      destination.put(outRow, 0, width);
    }
    destination.position(0);
  }
}
