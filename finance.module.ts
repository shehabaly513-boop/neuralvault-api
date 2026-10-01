import {
  Module,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  Headers,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { AuthGuard } from './auth.guard';
import { AuthModule } from './auth.module';
import { randomUUID } from 'crypto';

const PLANS: any = {
  'AI Spark': { principal: 10, days: 7, fee: 0.02 },
  'Neural Rise': { principal: 25, days: 10, fee: 0.02 },
  'Quantum AI': { principal: 50, days: 14, fee: 0.025 },
  'AI Pro Max': { principal: 75, days: 21, fee: 0.03 },
  'Neural Elite': { principal: 100, days: 30, fee: 0.03 },
};

const D = (x: any) => Number(x);
const dec = (x: number) => x.toFixed(8);

@Controller('finance')
@UseGuards(AuthGuard)
export class FinanceController {
  constructor(private db: PrismaService) {}

  private async accounts(tx: any, userId: string) {
    const a = await tx.account.findMany({ where: { userId } });
    return Object.fromEntries(a.map((x: any) => [x.type, x]));
  }

  private async ensureSystem(tx: any) {
    let u = await tx.user.findUnique({
      where: { email: 'system@neuralvault.local' },
    });

    if (!u) {
      u = await tx.user.create({
        data: {
          email: 'system@neuralvault.local',
          passwordHash: 'SYSTEM',
          role: 'ADMIN',
          accounts: {
            create: {
              type: 'SYSTEM',
              currency: 'USD',
            },
          },
        },
      });
    }

    return u;
  }

  private async move(
    tx: any,
    userId: string,
    from: string,
    to: string,
    amount: number,
    type: any,
    referenceId?: string,
    description?: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const acc = await this.accounts(tx, userId);

    if (!acc[from] || !acc[to]) {
      throw new BadRequestException('Required account missing');
    }

    if (D(acc[from].balance) < amount) {
      throw new BadRequestException('Insufficient available balance');
    }

    await tx.account.update({
      where: { id:
