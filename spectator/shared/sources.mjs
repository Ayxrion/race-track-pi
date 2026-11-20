export const SOURCES = Object.freeze({
  esp32: Object.freeze({ label: 'ESP32', publishPath: '/api/publish' }),
  pi: Object.freeze({ label: 'Race Track Pi', publishPath: '/api/publish/pi' }),
});

export const isSource = value => Object.hasOwn(SOURCES, value);
export const sourceFromSearch = search => {
  const value = new URLSearchParams(search).get('source');
  return isSource(value) ? value : 'esp32';
};
