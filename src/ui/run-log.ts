import { parseRunLog as parse, validateRunLog as validate } from './run-log/codec.ts'

export { applyRunLogEvent, runLogEventChoice, MAX_RUN_LOG_BYTES, type RunLog, type RunLogEvent } from './run-log/codec.ts'
export { readRunLog } from './run-log/storage.ts'
export { startRunLog, discardRunLog, useRunLog } from './run-log/recorder.ts'
export { readAssistantRunHistory, readAssistantRunHistoryPage, type RunHistoryQuery } from './run-log/history.ts'
export { downloadRunLog, playRunLog, queryRunLogControl, type ReplayPace } from './run-log/player.ts'

function validSelector(selector: string) {
  document.createDocumentFragment().querySelector(selector)
  return true
}

export const validateRunLog = (value: unknown) => validate(value, validSelector)
export const parseRunLog = (text: string) => parse(text, validSelector)
