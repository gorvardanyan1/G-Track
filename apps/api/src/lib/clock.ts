/** Injected everywhere time matters, so tests can move time forward. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
