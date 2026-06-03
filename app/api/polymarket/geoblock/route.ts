import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import {
  checkPolymarketGeoblock,
  formatGeoblockMessage,
} from '@/lib/clients/polymarket-geoblock';

export async function GET() {
  try {
    const geo = await checkPolymarketGeoblock({ force: true });
    return NextResponse.json({
      ...geo,
      message: formatGeoblockMessage(geo),
      hostingHint: {
        primaryServers: 'eu-west-2',
        closestNonGeorestricted: 'eu-west-1',
        note: 'Deploy Sniper where egress IP passes geoblock; co-location in eu-west-2 requires Polymarket KYC/KYB.',
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(err) || 'Geoblock check failed' },
      { status: 500 },
    );
  }
}
