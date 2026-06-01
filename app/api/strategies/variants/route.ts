import { NextResponse } from 'next/server';
import { getAllVariants } from '@/lib/strategies/variants';

export async function GET() {
  const variants = getAllVariants();
  return NextResponse.json({ variants });
}
