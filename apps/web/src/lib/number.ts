/**
 * An optional numeric field: empty → null. Vue's v-model on a number input yields a number
 * once something is typed and '' when cleared, so both are accepted.
 */
export const optionalNumber = (value: string | number): number | null =>
  String(value).trim() === '' ? null : Number(value);
