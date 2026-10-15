// Input limits that mirror the server's validation.

// DR-04: task description, in characters after trimming.
export const TASK_DESCRIPTION = { min: 10, max: 1000 };

// Part L: shift report text, in characters after trimming; title length.
export const REPORT_TEXT = { min: 10, max: 5000 };
export const REPORT_TITLE_MAX = 160;
