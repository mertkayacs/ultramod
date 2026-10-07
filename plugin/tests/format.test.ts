import { expect, test } from 'claude-code/testing'
import { fmtCountdown, fmtDuration, fmtModel, fmtTokens, fmtUsd } from '../hooks/core/format'

test('formats tokens at display boundaries', () => {
  expect(fmtTokens(0)).toBe('0')
  expect(fmtTokens(999)).toBe('999')
  expect(fmtTokens(1_000)).toBe('1k')
  expect(fmtTokens(124_000)).toBe('124k')
  expect(fmtTokens(1_200_000)).toBe('1.2m')
})

// fmtDuration: elapsed time, seconds kept under an hour (the HUD turn timer
// and the receipt line).
test('durations keep seconds under an hour', () => {
  expect(fmtDuration(-1)).toBe('0s')
  expect(fmtDuration(999)).toBe('0s')
  expect(fmtDuration(45_000)).toBe('45s')
  expect(fmtDuration(59_999)).toBe('59s')
  expect(fmtDuration(60_000)).toBe('1m00s')
  expect(fmtDuration(72_000)).toBe('1m12s')
  expect(fmtDuration(125_000)).toBe('2m05s')
  expect(fmtDuration(134_000)).toBe('2m14s')
  expect(fmtDuration(2_460_000)).toBe('41m00s')
  expect(fmtDuration(3_599_999)).toBe('59m59s')
  expect(fmtDuration(3_600_000)).toBe('1h00m')
  expect(fmtDuration(3_780_000)).toBe('1h03m')
  expect(fmtDuration(28_200_000)).toBe('7h50m')
  expect(fmtDuration(86_399_999)).toBe('23h59m')
  expect(fmtDuration(86_400_000)).toBe('1d0h')
  expect(fmtDuration(93_600_000)).toBe('1d2h')
  expect(fmtDuration(273_600_000)).toBe('3d4h')
})

// fmtCountdown: time until a reset or since a snapshot, one unit per band
// under a day (the HUD resets and the undo ages).
test('countdowns carry one unit per band under a day', () => {
  expect(fmtCountdown(-1)).toBe('0s')
  expect(fmtCountdown(45_000)).toBe('45s')
  expect(fmtCountdown(59_999)).toBe('59s')
  expect(fmtCountdown(60_000)).toBe('1m')
  expect(fmtCountdown(2_460_000)).toBe('41m')
  expect(fmtCountdown(3_599_999)).toBe('59m')
  expect(fmtCountdown(3_600_000)).toBe('1h00m')
  expect(fmtCountdown(28_200_000)).toBe('7h50m')
  expect(fmtCountdown(86_399_999)).toBe('23h59m')
  expect(fmtCountdown(86_400_000)).toBe('1d0h')
  expect(fmtCountdown(273_600_000)).toBe('3d4h')
})

test('formats session cost with two decimal places', () => {
  expect(fmtUsd(0)).toBe('$0.00')
  expect(fmtUsd(1.84)).toBe('$1.84')
  expect(fmtUsd(1.846)).toBe('$1.85')
})

test('formats known models and preserves unknown ids after removing the prefix', () => {
  expect(fmtModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(fmtModel('claude-sonnet-5-5-20261001')).toBe('Sonnet 5.5')
  expect(fmtModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(fmtModel('claude-opus-4')).toBe('Opus 4')
  expect(fmtModel('claude-custom-20261001')).toBe('custom-20261001')
  expect(fmtModel('custom/model')).toBe('custom/model')
})
