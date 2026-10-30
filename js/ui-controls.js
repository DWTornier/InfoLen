/* ============================================================
   InfoLen · M3 控件工厂
   ============================================================ */

import { el, clamp } from "./util.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";

export function section(title, iconName, children = []) {
  const head = el("div", { class: "section__title" }, [
    el("span", { html: icon(iconName), "aria-hidden": "true" }),
    el("span", { text: title }),
  ]);
  return el("section", { class: "section" }, [head, ...children]);
}

export function slider({ label, min = 0, max = 1, step = 0.01, value = 0, format = (v) => v.toFixed(2), onInput }) {
  const valueNode = el("span", { class: "slider__value", text: format(value) });
  const input = el("input", {
    type: "range",
    min,
    max,
    step,
    value,
    "aria-label": label,
  });
  const fill = () => {
    const p = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${clamp(p, 0, 100)}%`);
  };
  input.addEventListener("input", () => {
    const v = Number(input.value);
    valueNode.textContent = format(v);
    fill();
    onInput?.(v);
  });
  fill();
  const root = el("label", { class: "slider" }, [
    el("div", { class: "slider__head" }, [el("span", { class: "slider__label", text: label }), valueNode]),
    input,
  ]);
  root.setValue = (v) => {
    input.value = v;
    valueNode.textContent = format(Number(v));
    fill();
  };
  return root;
}

export function switchRow({ label, desc, value = false, onChange }) {
  const toggle = el("button", {
    class: `switch${value ? " is-on" : ""}`,
    type: "button",
    role: "switch",
    "aria-checked": String(!!value),
    "aria-label": label,
  });
  let state = !!value;
  toggle.addEventListener("click", () => {
    state = !state;
    toggle.classList.toggle("is-on", state);
    toggle.setAttribute("aria-checked", String(state));
    onChange?.(state);
  });
  const root = el("div", { class: "switch-row" }, [
    el("div", { class: "switch-row__text" }, [
      el("span", { class: "switch-row__label", text: label }),
      desc ? el("span", { class: "switch-row__desc", text: desc }) : null,
    ]),
    toggle,
  ]);
  root.setValue = (v) => {
    state = !!v;
    toggle.classList.toggle("is-on", state);
    toggle.setAttribute("aria-checked", String(state));
  };
  return root;
}

export function selectField({ label, options, value, onChange }) {
  const select = el("select", { "aria-label": label });
  options.forEach((o) => select.append(el("option", { value: o.value, text: o.label })));
  select.value = value;
  select.addEventListener("change", () => onChange?.(select.value));
  const root = el("div", { class: "field" }, [
    label ? el("span", { class: "field__label", text: label }) : null,
    el("div", { class: "select" }, [
      select,
      el("span", { class: "select__caret", html: icon("expand_more"), "aria-hidden": "true" }),
    ]),
  ]);
  root.setValue = (v) => { select.value = v; };
  return root;
}

export function segmented({ options, value, onChange, block = true }) {
  const items = options.map((o) => {
    const node = el("button", {
      class: `segmented__item${o.value === value ? " is-selected" : ""}`,
      type: "button",
      title: o.label,
      "aria-label": o.label,
      "data-value": o.value,
      html: o.icon ? `${icon(o.icon)}<span>${o.label}</span>` : `<span>${o.label}</span>`,
    });
    node.addEventListener("click", () => {
      items.forEach((n) => n.classList.toggle("is-selected", n === node));
      onChange?.(o.value);
    });
    return node;
  });
  const root = el("div", { class: `segmented${block ? " segmented--block" : ""}`, role: "group" }, items);
  root.setValue = (v) => items.forEach((n) => n.classList.toggle("is-selected", n.dataset.value === String(v)));
  return root;
}

export function chips({ options, value, onChange, multi = false }) {
  let current = multi ? [...value] : value;
  const nodes = options.map((o) => {
    const node = el("button", {
      class: "chip",
      type: "button",
      html: o.icon ? `${icon(o.icon)}<span>${o.label}</span>` : `<span>${o.label}</span>`,
    });
    const isOn = multi ? current.includes(o.value) : current === o.value;
    node.classList.toggle("is-selected", isOn);
    node.addEventListener("click", () => {
      if (multi) {
        current = current.includes(o.value) ? current.filter((v) => v !== o.value) : [...current, o.value];
      } else {
        current = o.value;
      }
      nodes.forEach((n, i) => {
        const v = options[i].value;
        n.classList.toggle("is-selected", multi ? current.includes(v) : current === v);
      });
      onChange?.(multi ? [...current] : current);
    });
    return node;
  });
  const root = el("div", { class: "chips" }, nodes);
  root.setValue = (v) => {
    current = v;
    nodes.forEach((n, i) => {
      const ov = options[i].value;
      n.classList.toggle("is-selected", multi ? current.includes(ov) : current === ov);
    });
  };
  return root;
}

export function statGrid(stats) {
  const root = el("div", { class: "stat-grid" });
  const refs = stats.map((s) => {
    const value = el("div", { class: `stat__value${s.small ? " stat__value--sm" : ""}`, text: s.value ?? "—" });
    root.append(el("div", { class: "stat" }, [el("div", { class: "stat__label", text: s.label }), value]));
    return value;
  });
  root.setValue = (i, v) => { if (refs[i]) refs[i].textContent = v; };
  return root;
}

export function colorInput({ label, value, onChange }) {
  const input = el("input", { type: "color", value, "aria-label": label });
  const text = el("input", { type: "text", value, spellcheck: "false", "aria-label": `${label} 十六进制` });
  const sync = (v, from) => {
    if (from !== "color") input.value = v;
    if (from !== "text") text.value = v;
    onChange?.(v);
  };
  input.addEventListener("input", () => sync(input.value, "color"));
  text.addEventListener("change", () => {
    const v = /^#?[0-9a-fA-F]{6}$/.test(text.value.trim())
      ? `#${text.value.trim().replace("#", "")}`
      : null;
    if (v) sync(v, "text"); else text.value = input.value;
  });
  const root = el("div", { class: "input input--color" }, [input, text]);
  root.setValue = (v) => { input.value = v; text.value = v; };
  return root;
}

export function layerCard({ iconName, title, subtitle, swatch, visible, onToggle, onExpand, children }) {
  const eyeBtn = el("button", {
    class: "icon-button icon-button--sm",
    html: icon(visible ? "eye" : "eye_off"),
    title: t(visible ? "layer.hide" : "layer.show"),
    "aria-label": t(visible ? "layer.hide" : "layer.show"),
  });
  const expandBtn = el("button", {
    class: "icon-button icon-button--sm",
    html: icon("expand_more"),
    title: t("ctrl.expand"),
    "aria-label": t("ctrl.expand"),
  });
  const body = el("div", { class: "layer-card__body" }, children);
  let expanded = true;
  expandBtn.addEventListener("click", () => {
    expanded = !expanded;
    body.hidden = !expanded;
    expandBtn.style.transform = expanded ? "" : "rotate(-90deg)";
    onExpand?.(expanded);
  });
  eyeBtn.addEventListener("click", () => onToggle?.());
  const root = el("div", { class: `layer-card${visible ? " is-on" : ""}` }, [
    el("div", { class: "layer-card__head" }, [
      el("span", { class: "layer-card__swatch", style: swatch ? `--swatch:${swatch}` : "", html: icon(iconName) }),
      el("div", { class: "layer-card__title" }, [
        el("span", { class: "title-small", text: title }),
        subtitle ? el("span", { class: "body-small", text: subtitle }) : null,
      ]),
      eyeBtn,
      expandBtn,
    ]),
    body,
  ]);
  root.setEye = (v) => { eyeBtn.innerHTML = icon(v ? "eye" : "eye_off"); root.classList.toggle("is-on", v); };
  return root;
}
