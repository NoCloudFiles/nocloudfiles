import "./site.js";
import ExifReader from "exifreader";
import { track } from "./analytics-ui.js";
import { tr } from "./i18n.js";
import { setupDropzone } from "./dropzone.js";
import { sniffImage } from "./core.js";
import {
  baselinePixels,
  addSelectedFields,
  opaqueSegments,
  properties,
  parseXmpCoordinate,
  canvasDimensions,
} from "./privacy-core.js";

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

const input = document.querySelector("#photo"),
  status = document.querySelector("#status");
const panel = document.querySelector("#inspection");
const event = (name) => track(name, { input_source: "file" });
const el = (tag, text) =>
  Object.assign(document.createElement(tag), { textContent: text ?? "" });
const drop = setupDropzone({
  zone: document.querySelector("#photo-drop"),
  input,
  status: document.querySelector("#photo-file-status"),
});
function stepPanel(number, title) {
  const section = el("section"),
    head = el("div"),
    step = el("span", String(number));
  section.className = "panel";
  head.className = "panel-title";
  step.className = "step";
  head.append(step, el("h2", title));
  section.append(head);
  return section;
}
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
    latitude: first(
      Number.isFinite(t.gps?.Latitude) ? t.gps.Latitude : undefined,
      parseXmpCoordinate(x.GPSLatitude),
    ),
    longitude: first(
      Number.isFinite(t.gps?.Longitude) ? t.gps.Longitude : undefined,
      parseXmpCoordinate(x.GPSLongitude),
    ),
  };
}
function scanMarkers(bytes) {
  const signature = new TextDecoder("latin1").decode(bytes);
  return {
    motion:
      /MotionPhoto|MicroVideo|ContentIdentifier|com\.apple\.quicktime\.content\.identifier|MotionPhoto_Data/.test(
        signature,
      ),
    hdr: /hdrgm:|hdr-gain-map|HDRGainMap|urn:iso:std:iso:ts:21496/.test(
      signature,
    ),
    colorManaged: /ICC_PROFILE|Adobe/.test(signature),
  };
}
async function parseOriginal(file) {
  if (file.size > 32_000_000 || !file.size)
    throw new UserError(
      tr(
        "请选择 32 MB 以内的非空照片。",
        "Choose a nonempty photo up to 32 MB.",
      ),
    );
  const buffer = await file.arrayBuffer(),
    bytes = new Uint8Array(buffer),
    type = sniffImage(bytes);
  if (!["jpeg", "heic"].includes(type))
    throw new UserError(
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
    throw new UserError(
      tr(
        "无法确认尺寸，或图片超过 5000 万像素。",
        "Dimensions are unavailable or exceed 50 megapixels.",
      ),
    );
  const { motion, hdr, colorManaged } = scanMarkers(bytes);
  const opaque = type === "jpeg" ? opaqueSegments(bytes) : [];
  // Preserve scan data for unrotated 3-component baseline JPEGs without color profiles or motion/HDR data.
  const canUseBaseline =
    type === "jpeg" &&
    !motion &&
    !hdr &&
    !colorManaged &&
    Number(tags.exif?.Orientation?.value ?? 1) === 1 &&
    Number(tags.xmp?.Orientation?.value ?? 1) === 1 &&
    Number(tags.file?.["Color Components"]?.value) === 3;
  const losslessJpeg = canUseBaseline ? baselinePixels(bytes) : null;
  return { type, tags, motion, hdr, opaque, losslessJpeg };
}
async function encodeWithCanvas(img) {
  let dims = canvasDimensions(img.naturalWidth, img.naturalHeight);
  for (let attempt = 0; attempt < 4; attempt++) {
    const c = document.createElement("canvas");
    c.width = dims.width;
    c.height = dims.height;
    try {
      let ctx = null;
      try {
        ctx = c.getContext("2d", { colorSpace: "srgb" });
      } catch {
        // Older browsers may reject context options.
      }
      if (!ctx) ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, dims.width, dims.height);
        const blob = await new Promise((resolve) =>
          c.toBlob(resolve, "image/jpeg", 0.97),
        );
        if (blob) return { blob, ...dims };
      }
    } finally {
      c.width = c.height = 1;
    }
    const nextMax = Math.floor((dims.width * dims.height) / 2);
    if (nextMax < 250_000) break;
    dims = canvasDimensions(img.naturalWidth, img.naturalHeight, nextMax);
  }
  throw Error("encode");
}
function buildErrorMessage(error) {
  switch (error?.message) {
    case "paired_gps":
      return tr(
        "请同时勾选并填写纬度和经度。",
        "Select and enter both latitude and longitude together.",
      );
    case "coordinate":
      return tr(
        "经纬度格式或范围无效。纬度需在 -90 到 90 之间，经度需在 -180 到 180 之间。",
        "Invalid coordinate format or range. Latitude must be between -90 and 90, and longitude between -180 and 180.",
      );
    case "value":
      return tr(
        "所选字段包含无法写入的控制字符、异常字符，或超过 1024 个字符。",
        "A selected field contains unsupported control or corrupt characters, or exceeds 1,024 characters.",
      );
    case "size":
      return tr(
        "所选字段总长度超出 JPEG 元数据上限，请精简后再试。",
        "Selected fields exceed the JPEG metadata size limit. Shorten the text and try again.",
      );
    case "encode":
      return tr(
        "浏览器无法重新编码这张图片（可能超出当前设备的画布像素限制）。请缩小图片后重试。",
        "This browser could not re-encode the image (it may exceed this device's canvas limit). Try a smaller photo.",
      );
    case "verify":
      return tr(
        "副本未通过重读核对，已取消下载。请检查输入内容后重试。",
        "The copy failed re-read verification and was not offered for download. Check your inputs and try again.",
      );
    default:
      return tr(
        "生成副本时发生意外错误，请重试或换一张照片。",
        "An unexpected error occurred while creating the copy. Please try again or choose another photo.",
      );
  }
}
function bindBuilder({
  id,
  img,
  losslessJpeg,
  controls,
  build,
  fictional,
  result,
  clearResult,
}) {
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
      let jpeg = losslessJpeg;
      let scaledDims = null;
      if (!jpeg) {
        const encoded = await encodeWithCanvas(img);
        if (id !== revision) return;
        jpeg = encoded.blob;
        if (encoded.scaled) scaledDims = encoded;
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
      if (scaledDims) {
        const note = el(
          "p",
          tr(
            `为适配浏览器画布上限，副本已等比缩放为 ${scaledDims.width} × ${scaledDims.height}。`,
            `Scaled proportionally to ${scaledDims.width} × ${scaledDims.height} to fit browser canvas limits.`,
          ),
        );
        note.className = "small";
        result.append(note);
      }
      const link = el("a", tr("下载静态 JPEG", "Download still JPEG"));
      link.className = "button download";
      link.download = "private-photo.jpg";
      link.href = downloadUrl = URL.createObjectURL(output);
      link.addEventListener("click", () => event("download_click"), {
        once: true,
      });
      result.append(link);
      event("photo_ready");
    } catch (error) {
      if (id !== revision) return;
      const failure = el("p", buildErrorMessage(error));
      failure.className = "notice error";
      failure.setAttribute("role", "alert");
      result.replaceChildren(failure);
      track("generate_error", {
        input_source: "file",
        error_code: "generation_failed",
      });
    } finally {
      if (id !== revision) return;
      build.disabled = false;
      fictional.disabled = false;
      for (const { check, editor } of controls.values()) {
        check.disabled = false;
        editor.disabled = !check.checked;
      }
    }
  };
}
async function inspect(file, id) {
  const { type, tags, motion, hdr, opaque, losslessJpeg } =
    await parseOriginal(file);
  if (id !== revision) return;
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
    throw new UserError(tr("图片过大。", "Photo is too large."));
  img.alt = tr("静态主图预览", "Still photo preview");
  img.className = "privacy-preview";
  const review = stepPanel(2, tr("原件中的信息", "What the original contains"));
  review.append(img);
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
  if (detected.length) {
    const found = el("ul");
    found.className = "found";
    found.setAttribute("aria-label", tr("原件含有", "Found in the original"));
    for (const label of detected) found.append(el("li", label));
    review.append(el("p", tr("原件含有：", "Found in the original:")), found);
  } else
    review.append(
      el(
        "p",
        tr(
          "未识别到下方 8 项可编辑的个人信息。原件仍可能包含其他技术或设备字段（可展开下方列表查看），生成副本时都会一并移除。",
          "None of the 8 editable personal fields were found. The original may still contain other technical or device metadata (expand the list below to inspect), which will also be removed in the private copy.",
        ),
      ),
    );
  info.className = "small";
  review.append(info);
  const details = el("details"),
    list = el("dl");
  list.className = "field-list";
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
  for (const block of opaque) {
    list.append(
      el("dt", tr("未识别的数据块", "Unrecognized block")),
      el("dd", block + tr(" · 移除", " · removed")),
    );
  }
  review.append(details);
  const choose = stepPanel(
    3,
    tr("副本中保留哪些信息？", "What should the copy include?"),
  );
  const fieldsBox = el("div");
  fieldsBox.className = "privacy-fields";
  panel.append(review, choose);
  choose.append(
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
  result.className = "privacy-output";
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
    editor.type = "text";
    row.append(check, caption, editor);
    fieldsBox.append(row);
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
  const actions = el("div");
  actions.className = "actions";
  actions.append(build, fictional);
  choose.append(fieldsBox, actions, result);
  bindBuilder({
    id,
    img,
    losslessJpeg,
    controls,
    build,
    fictional,
    result,
    clearResult,
  });
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
  delete status.dataset.state;
  const file = input.files[0];
  if (!file) return;
  event("tool_start");
  status.textContent = tr("正在读取原件…", "Reading original…");
  try {
    await inspect(file, id);
  } catch (error) {
    if (id !== revision) return;
    input.value = "";
    drop.refresh();
    panel.replaceChildren();
    status.dataset.state = "error";
    status.textContent =
      error instanceof UserError
        ? error.message
        : tr(
            "无法读取照片，请确认它是未损坏的 JPEG 或 HEIC 静态原图。",
            "Could not read the photo. Make sure it is an undamaged JPEG or HEIC still photo.",
          );
    track("generate_error", {
      input_source: "file",
      error_code: "input_rejected",
    });
  }
};
