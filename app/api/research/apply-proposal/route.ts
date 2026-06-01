import { NextResponse } from 'next/server';
import { createVariantFromProposal } from '@/lib/strategies/variants';

export async function POST(req: Request) {
  const body = await req.json();
  const { proposal } = body;

  if (!proposal) {
    return NextResponse.json({ error: 'Proposal required' }, { status: 400 });
  }

  const variant = createVariantFromProposal(proposal);

  return NextResponse.json({ 
    success: true, 
    variant,
    message: 'Variant created from proposal. You can now test it in replay.' 
  });
}
