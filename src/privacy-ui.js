import "./site.js";
import "./privacy.css";
import ExifReader from "exifreader";
import { track } from "./analytics-ui.js";
import { tr } from "./i18n.js";
import { sniffImage } from "./core.js";
import {
  baselinePixels,
  addSelectedFields,
  opaqueSegments,
  properties,
} from "./privacy-core.js";

const input = document.querySelector("#photo"),
  status = document.querySelector("#status");
const panel = document.querySelector("#inspection");
const event = (name) => track(name, { input_source: "file" });
const el = (tag, text) =>
  Object.assign(document.createElement(tag), { textContent: text ?? "" });
const labels = {
  author: tr("署名", "Author"),
  city: tr("城市", "City"),
  date: tr("拍摄时间", "Capture time"),
  description: tr("说明", "Description"),
  rights: tr("版权", "Copyright"),
  model: tr("设备型号", "Device model"),
  latitude: tr("纬度", "Latitude"),
  longitude: tr("经度", "Longitude"),
};
let revision = 0,
  downloadUrl,
  previewUrl;
function revoke(url) {
  if (url) URL.revokeObjectURL(url);
}
function visibleValue(tag) {
  if (typeof tag === "number" || typeof tag === "string") return String(tag);
  const value = tag?.description ?? tag?.value;
  if (typeof value === "number" || typeof value === "string")
    return String(value);
  if (Array.isArray(value) && value.length <= 100) return JSON.stringify(value);
  return tr("二进制或复合数据（移除）", "Binary or structured data (removed)");
}
const first = (...values) => values.find((v) => v !== undefined && v !== null);
function choices(t) {
  const x = t.xmp ?? {},
    e = t.exif ?? {},
    i = t.iptc ?? {};
  return {
    author: first(x.creator, e.Artist, i["By-line"]),
    city: first(x.City, i.City),
    date: first(x.CreateDate, e.DateTimeOriginal),
    description: first(
      x.description,
      e.ImageDescription,
      i["Caption/Abstract"],
    ),
    rights: first(x.rights, e.Copyright, i["Copyright Notice"]),
    model: first(x.Model, e.Model),
    latitude: t.gps?.Latitude,
    longitude: t.gps?.Longitude,
  };
}
async function inspect(file, id) {
  if (file.size > 32_000_000 || !file.size)
    throw Error(
      tr(
        "请选择 32 MB 以内的非空照片。",
        "Choose a nonempty photo up to 32 MB.",
      ),
    );
  const buffer = await file.arrayBuffer(),
    bytes = new Uint8Array(buffer),
    type = sniffImage(bytes);
  if (!["jpeg", "heic"].includes(type))
    throw Error(
      tr(
        "请选择 JPEG 或 HEIC/HEIF 静态照片。",
        "Choose a JPEG or HEIC/HEIF still photo.",
      ),
    );
  const tags = ExifReader.load(buffer, {
    expanded: true,
    includeUnknown: true,
  });
  const width = Number(tags.file?.["Image Width"]?.value),
    height = Number(tags.file?.["Image Height"]?.value);
  if (!width || !height || width * height > 50_000_000)
    throw Error(
      tr(
        "无法确认尺寸，或图片超过 5000 万像素。",
        "Dimensions are unavailable or exceed 50 megapixels.",
      ),
    );
  const signature = new TextDecoder("latin1").decode(bytes);
  const motion =
    /MotionPhoto|MicroVideo|ContentIdentifier|com\.apple\.quicktime\.content\.identifier|MotionPhoto_Data/.test(
      signature,
    );
  const hdr = /hdrgm:|hdr-gain-map|HDRGainMap|urn:iso:std:iso:ts:21496/.test(
    signature,
  );
  let source = file;
  if (type === "heic") {
    const { heicTo } = await import("heic-to/csp");
    if (id !== revision) return;
    source = await heicTo({ blob: file, type: "image/jpeg", quality: 0.97 });
  }
  if (id !== revision) return;
  const img = new Image();
  previewUrl = URL.createObjectURL(source);
  img.src = previewUrl;
  await img.decode();
  if (id !== revision) return;
  if (img.naturalWidth * img.naturalHeight > 50_000_000)
    throw Error(tr("图片过大。", "Photo is too large."));
  img.alt = tr("静态主图预览", "Still photo preview");
  img.className = "privacy-preview";
  panel.append(img);
  const info = el(
    "p",
    tr(
      "将导出静态 JPEG。仅处理所选照片，配对的视频文件不包含在副本内。",
      "Exports a still JPEG. A paired video is separate and is excluded.",
    ),
  );
  if (motion)
    info.append(
      el(
        "strong",
        tr(
          " 检测到动态照片标记，视频将移除。",
          " Motion photo marker detected. Video will be removed.",
        ),
      ),
    );
  if (hdr)
    info.append(
      el(
        "strong",
        tr(
          " 检测到 HDR 辅助数据，副本将使用标准亮度。",
          " HDR data detected. The copy uses standard brightness.",
        ),
      ),
    );
  if (!hdr)
    info.append(
      el(
        "span",
        tr(
          " 副本仅保留标准亮度主图。",
          " The copy contains the standard-brightness image only.",
        ),
      ),
    );
  const defaults = choices(tags);
  const detected = Object.entries(defaults)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => labels[key]);
  panel.append(
    el(
      "p",
      detected.length
        ? tr("原件含有：", "Found in the original: ") + detected.join(" · ")
        : tr(
            "未识别到可编辑的个人信息。展开下方列表可检查其他字段。",
            "No editable personal details identified. Expand the list to inspect other fields.",
          ),
    ),
    info,
  );
  const details = el("details"),
    list = el("dl");
  details.append(
    el("summary", tr("查看原件中识别出的字段", "Inspect original metadata")),
    list,
  );
  for (const [group, t] of Object.entries(tags)) {
    for (const [key, tag] of Object.entries(t)) {
      if (key === "_raw") {
        list.append(
          el("dt", "XMP / " + tr("原始数据包", "Original packet")),
          el("dd", String(tag)),
        );
        continue;
      }
      list.append(el("dt", group + " / " + key), el("dd", visibleValue(tag)));
    }
  }
  if (type === "jpeg")
    for (const block of opaqueSegments(bytes)) {
      list.append(
        el("dt", tr("未识别的数据块", "Unrecognized block")),
        el("dd", block + tr(" · 移除", " · removed")),
      );
    }
  panel.append(
    details,
    el("h2", tr("副本中保留哪些信息？", "What should the copy include?")),
    el(
      "p",
      tr(
        "默认全部移除，包括无法识别的数据块和缩略图。勾选字段可保留或改写其值；坐标使用十进制度。",
        "All original metadata, including unrecognized blocks and thumbnails, is removed. Select fields to keep or replace. Enter coordinates in decimal degrees.",
      ),
    ),
  );
  const controls = new Map(),
    result = el("div");
  function clearResult() {
    revoke(downloadUrl);
    downloadUrl = null;
    result.replaceChildren();
  }
  for (const [key, label] of Object.entries(labels)) {
    const row = el("div"),
      check = el("input"),
      editor = el("input"),
      caption = el("label", label);
    row.className = "privacy-row";
    check.type = "checkbox";
    check.id = "keep-" + key;
    caption.htmlFor = check.id;
    editor.setAttribute("aria-label", label);
    editor.maxLength = 1024;
    editor.disabled = true;
    editor.value =
      defaults[key] === undefined ? "" : visibleValue(defaults[key]);
    check.onchange = () => {
      editor.disabled = !check.checked;
      clearResult();
    };
    editor.oninput = clearResult;
    controls.set(key, { check, editor });
    row.append(check, caption, editor);
    panel.append(row);
  }
  const fictional = el("button", tr("填入虚构示例", "Fill fictional details"));
  fictional.onclick = () => {
    for (const [key, value] of Object.entries({
      author: "Example Traveler",
      city: "Example City",
      date: "2000-01-01",
    })) {
      const { check, editor } = controls.get(key);
      check.checked = true;
      editor.disabled = false;
      editor.value = value;
    }
    for (const key of ["latitude", "longitude"]) {
      const { check, editor } = controls.get(key);
      check.checked = false;
      editor.disabled = true;
    }
    clearResult();
  };
  const build = el("button", tr("生成隐私副本", "Create private copy"));
  build.className = "primary";
  panel.append(fictional, build, result);
  build.onclick = async () => {
    clearResult();
    build.disabled = true;
    const fields = {};
    for (const [key, { check, editor }] of controls)
      if (check.checked && editor.value.trim())
        fields[key] = editor.value.trim();
    for (const { check, editor } of controls.values()) {
      check.disabled = true;
      editor.disabled = true;
    }
    fictional.disabled = true;
    try {
      // Preserve scan data only for simple unprofiled, unrotated RGB images.
      let jpeg =
        type === "jpeg" &&
        !motion &&
        !hdr &&
        !/Exif\u0000|ICC_PROFILE|Adobe|xmpmeta/.test(signature) &&
        Number(tags.file["Color Components"]?.value) === 3
          ? baselinePixels(bytes)
          : null;
      if (!jpeg) {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        try {
          c.getContext("2d", { colorSpace: "srgb" }).drawImage(img, 0, 0);
          jpeg = await new Promise((resolve) =>
            c.toBlob(resolve, "image/jpeg", 0.97),
          );
        } finally {
          c.width = c.height = 1;
        }
        if (!jpeg) throw Error("encode");
      }
      const output = addSelectedFields(jpeg, fields);
      const checked = ExifReader.load(await output.arrayBuffer(), {
        expanded: true,
      });
      if (id !== revision) return;
      const verified = [];
      for (const key of Object.keys(labels)) {
        const tag = checked.xmp?.[properties[key][0].split(":")[1]];
        if (Boolean(tag) !== Object.hasOwn(fields, key)) throw Error("verify");
        if (tag) verified.push(labels[key] + " · " + visibleValue(tag));
      }
      result.append(
        el(
          "p",
          tr(
            "已重读副本。写入的可选字段：",
            "Copy re-opened. Optional fields written: ",
          ) + (verified.join(" / ") || tr("无", "none")),
        ),
      );
      const link = el("a", tr("下载静态 JPEG", "Download still JPEG"));
      link.download = "private-photo.jpg";
      link.href = downloadUrl = URL.createObjectURL(output);
      link.addEventListener("click", () => event("download_click"), {
        once: true,
      });
      result.append(link);
      event("photo_ready");
    } catch {
      result.replaceChildren(
        el(
          "p",
          tr(
            "无法生成副本。请检查所选值和经纬度范围。",
            "Could not create the copy. Check selected values and coordinate ranges.",
          ),
        ),
      );
      track("generate_error", {
        input_source: "file",
        error_code: "generation_failed",
      });
    } finally {
      build.disabled = false;
      fictional.disabled = false;
      for (const { check, editor } of controls.values()) {
        check.disabled = false;
        editor.disabled = !check.checked;
      }
    }
  };
  status.textContent = tr(
    "已在本地读取原件。",
    "Original inspected on this device.",
  );
  event("photo_inspected");
}
input.onchange = async () => {
  const id = ++revision;
  revoke(previewUrl);
  revoke(downloadUrl);
  panel.replaceChildren();
  status.textContent = "";
  const file = input.files[0];
  if (!file) return;
  event("tool_start");
  status.textContent = tr("正在读取原件…", "Reading original…");
  try {
    await inspect(file, id);
  } catch (error) {
    if (id !== revision) return;
    panel.replaceChildren();
    status.textContent =
      error.message || tr("无法读取照片。", "Could not read the photo.");
    track("generate_error", {
      input_source: "file",
      error_code: "input_rejected",
    });
  }
};
