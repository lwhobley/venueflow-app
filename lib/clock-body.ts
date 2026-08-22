export type ClockAttestation = {
  keyId: string;
  assertion: string;
  challenge: string;
};

export type ClockLocationBody = {
  lat: number;
  lng: number;
  accuracy: number;
  mocked: boolean;
  attestation?: ClockAttestation;
};

/**
 * Body builder for clock-in / clock-out. Must forward App Attest so the
 * official /v1/time-clock routes can verify the punch came from a genuine
 * build. Dropping `attestation` here is how a client-side bypass would look.
 */
export function locationBody(args: {
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  mocked?: unknown;
  attestation?: ClockAttestation | null;
}): ClockLocationBody {
  const body: ClockLocationBody = {
    lat: Number(args.lat),
    lng: Number(args.lng),
    accuracy: Number(args.accuracy),
    mocked: Boolean(args.mocked),
  };
  if (args.attestation && typeof args.attestation === 'object') {
    body.attestation = args.attestation;
  }
  return body;
}
