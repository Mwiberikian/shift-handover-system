// One-line operational log. Quiet under tests, which spy on it instead.
const quiet = () => process.env.NODE_ENV === 'test';

module.exports = {
  info: (...args) => { if (!quiet()) console.log(...args); },
  warn: (...args) => { if (!quiet()) console.warn(...args); },
};
