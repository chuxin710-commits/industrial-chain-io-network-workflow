import katex from 'katex';
import 'katex/dist/katex.min.css';

export function math(tex, displayMode = true) {
  return katex.renderToString(tex, {
    displayMode,
    output: 'htmlAndMathml',
    throwOnError: true,
    trust: false,
    strict: 'error',
  });
}
