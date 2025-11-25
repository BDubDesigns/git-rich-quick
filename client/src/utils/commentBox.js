export function countLines(element) {
  const computedStyle = window.getComputedStyle(element);

  // calculate visible content height by subtracting padding from total height
  const height =
    element.clientHeight -
    parseFloat(computedStyle.paddingTop) -
    parseFloat(computedStyle.paddingBottom);

  // retrieve line height, defaulting to 1.2× font size if not set
  let lineHeight = parseFloat(computedStyle.lineHeight);

  if (isNaN(lineHeight)) {
    lineHeight = parseFloat(computedStyle.fontSize) * 1.2;
  }

  if (lineHeight <= 0) return 0;

  // return total number of lines that fit in the container
  return Math.ceil(height / lineHeight);
}
