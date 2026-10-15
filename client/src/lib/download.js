import api from '../api';

// Fetches a file from the API with the session token and saves it under the
// name the server gave in Content-Disposition. Resolves with that name.
export async function downloadFile(path, params, fallbackName) {
  const res = await api.get(path, { params, responseType: 'blob' });
  const name = /filename="([^"]+)"/.exec(res.headers?.['content-disposition'] ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export const downloadReportPdf = (reportId) => downloadFile(`/reports/${reportId}/download`, { format: 'pdf' }, 'shift-report.pdf');
export const downloadReportsCsv = (filters) => downloadFile('/reports/export', { format: 'csv', ...filters }, 'shift-reports.csv');
