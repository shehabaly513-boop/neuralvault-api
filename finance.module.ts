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
    const a = await tx.account.findMany({
      where: { userId },
    });

    return Object.fromEntries(
      a.map((x: any) => [x.type, x]),
    );
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
      where: { id: acc[from].id },
      data: {
        balance: { decrement: dec(amount) },
        version: { increment: 1 },
      },
    });

    await tx.account.update({
      where: { id: acc[to].id },
      data: {
        balance: { increment: dec(amount) },
        version: { increment: 1 },
      },
    });

    const tid = randomUUID();

    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId: tid,
          userId,
          accountId: acc[from].id,
          type,
          amount: dec(amount),
          direction: 'DEBIT',
          referenceId,
          description,
        },
        {
          transactionId: tid,
          userId,
          accountId: acc[to].id,
          type,
          amount: dec(amount),
          direction: 'CREDIT',
          referenceId,
          description,
        },
      ],
    });

    return tid;
  }

  @Get('me')
  async me(@Req() r: any) {
    const userId = r.user.sub;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    const accounts = await this.db.account.findMany({
      where: { userId },
    });

    const investments = await this.db.investment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const withdrawals = await this.db.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const deposits = await this.db.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const tickets = await this.db.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const ledger = await this.db.ledgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      user,
      accounts,
      investments,
      withdrawals,
      deposits,
      tickets,
      ledger,
    };
  }

  @Get('plans')
  plans() {
    return Object.entries(PLANS).map(
      ([name, value]: any) => ({
        name,
        ...value,
      }),
    );
  }

  @Get('affiliate')
  async affiliate(@Req() r: any) {
    let a = await this.db.affiliateProfile.findUnique({
      where: { userId: r.user.sub },
    });

    if (!a) {
      a = await this.db.affiliateProfile.create({
        data: {
          userId: r.user.sub,
          referralCode:
            'NV-' + r.user.sub.slice(-8).toUpperCase(),
        },
      });
    }

    return a;
  }

  @Post('deposits')
  async deposit(@Req() r: any, @Body() b: any) {
    const amount = D(b.amount);

    if (amount <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    const key = b.idempotencyKey || randomUUID();

    const existing = await this.db.deposit.findUnique({
      where: { idempotencyKey: key },
    });

    if (existing) {
      return existing;
    }

    return this.db.deposit.create({
      data: {
        userId: r.user.sub,
        amount: dec(amount),
        currency: b.currency || 'USD',
        provider: b.provider || 'demo',
        idempotencyKey: key,
        status: 'PENDING',
      },
    });
  }

  @Post('deposits/:id/confirm')
  async confirm(
    @Req() r: any,
    @Param('id') id: string,
  ) {
    const dep = await this.db.deposit.findUnique({
      where: { id },
    });

    if (!dep || dep.userId !== r.user.sub) {
      throw new BadRequestException('Deposit not found');
    }

    if (dep.status === 'CONFIRMED') {
      return dep;
    }

    return this.db.$transaction(async (tx) => {
      const accounts = await this.accounts(
        tx,
        r.user.sub,
      );

      if (!accounts.AVAILABLE) {
        throw new BadRequestException(
          'Available account missing',
        );
      }

      const amount = D(dep.amount);

      await tx.account.update({
        where: { id: accounts.AVAILABLE.id },
        data: {
          balance: { increment: dec(amount) },
          version: { increment: 1 },
        },
      });

      const tid = randomUUID();

      await tx.ledgerEntry.create({
        data: {
          transactionId: tid,
          userId: r.user.sub,
          accountId: accounts.AVAILABLE.id,
          type: 'DEPOSIT',
          amount: dec(amount),
          currency: 'USD',
          direction: 'CREDIT',
          referenceId: id,
          description: 'Verified deposit',
        },
      });

      await tx.auditLog.create({
        data: {
          userId: r.user.sub,
          actorId: r.user.sub,
          action: 'DEPOSIT_CONFIRMED',
          entityType: 'Deposit',
          entityId: id,
        },
      });

      return tx.deposit.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });
    });
  }

  @Post('investments')
  async invest(
    @Req() r: any,
    @Body() b: any,
  ) {
    const p = PLANS[b.name];

    if (!p) {
      throw new BadRequestException(
        'Unknown plan',
      );
    }

    return this.db.$transaction(async (tx) => {
      const acc = await this.accounts(
        tx,
        r.user.sub,
      );

      if (
        !acc.AVAILABLE ||
        D(acc.AVAILABLE.balance) < p.principal
      ) {
        throw new BadRequestException(
          'Insufficient available balance',
        );
      }

      if (!acc.LOCKED) {
        throw new BadRequestException(
          'Locked account missing',
        );
      }

      const inv = await tx.investment.create({
        data: {
          userId: r.user.sub,
          name: b.name,
          principal: dec(p.principal),
          feeRate: dec(p.fee),
          status: 'LOCKED',
          startAt: new Date(),
          unlockAt: new Date(
            Date.now() + p.days * 86400000,
          ),
        },
      });

      await this.move(
        tx,
        r.user.sub,
        'AVAILABLE',
        'LOCKED',
        p.principal,
        'INVESTMENT_CREATED',
        inv.id,
        `Locked ${b.name}`,
      );

      return inv;
    });
  }

  @Post('investments/:id/settle')
  async settle(
    @Req() r: any,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return this.db.$transaction(async (tx) => {
      const inv = await tx.investment.findUnique({
        where: { id },
      });

      if (!inv || inv.userId !== r.user.sub) {
        throw new BadRequestException(
          'Investment not found',
        );
      }

      if (inv.status === 'COMPLETED') {
        return inv;
      }

      if (
        inv.unlockAt &&
        inv.unlockAt > new Date()
      ) {
        throw new BadRequestException(
          'Investment is still locked',
        );
      }

      const performance = D(b.performance || 0);
      const principal = D(inv.principal);
      const gross = principal + performance;
      const fee = gross * D(inv.feeRate);
      const net = Math.max(0, gross - fee);

      const acc = await this.accounts(
        tx,
        r.user.sub,
      );

      if (!acc.LOCKED || !acc.AVAILABLE) {
        throw new BadRequestException(
          'Required accounts missing',
        );
      }

      await tx.account.update({
        where: { id: acc.LOCKED.id },
        data: {
          balance: {
            decrement: dec(principal),
          },
          version: { increment: 1 },
        },
      });

      await tx.account.update({
        where: { id: acc.AVAILABLE.id },
        data: {
          balance: {
            increment: dec(net),
          },
          version: { increment: 1 },
        },
      });

      const tid = randomUUID();

      await tx.ledgerEntry.createMany({
        data: [
          {
            transactionId: tid,
            userId: r.user.sub,
            accountId: acc.LOCKED.id,
            type: 'INVESTMENT_UNLOCKED',
            amount: dec(principal),
            direction: 'DEBIT',
            referenceId: id,
          },
          {
            transactionId: tid,
            userId: r.user.sub,
            accountId: acc.AVAILABLE.id,
            type: 'INVESTMENT_UNLOCKED',
            amount: dec(net),
            direction: 'CREDIT',
            referenceId: id,
          },
        ],
      });

      return tx.investment.update({
        where: { id },
        data: {
          realizedPerformance: dec(performance),
          status: 'COMPLETED',
          settledAt: new Date(),
        },
      });
    });
  }

  @Post('withdrawals')
  async withdraw(
    @Req() r: any,
    @Body() b: any,
  ) {
    const amount = D(b.amount);

    if (
      amount <= 0 ||
      !b.address ||
      !b.network
    ) {
      throw new BadRequestException(
        'Amount, address and network required',
      );
    }

    const key =
      b.idempotencyKey || randomUUID();

    const existing =
      await this.db.withdrawal.findUnique({
        where: { idempotencyKey: key },
      });

    if (existing) {
      return existing;
    }

    return this.db.$transaction(async (tx) => {
      const acc = await this.accounts(
        tx,
        r.user.sub,
      );

      if (!acc.AVAILABLE || !acc.PENDING) {
        throw new BadRequestException(
          'Required accounts missing',
        );
      }

      if (
        D(acc.AVAILABLE.balance) < amount
      ) {
        throw new BadRequestException(
          'Insufficient available balance',
        );
      }

      const w = await tx.withdrawal.create({
        data: {
          userId: r.user.sub,
          amount: dec(amount),
          address: b.address,
          network: b.network,
          idempotencyKey: key,
          status: 'VALIDATING',
        },
      });

      await tx.account.update({
        where: { id: acc.AVAILABLE.id },
        data: {
          balance: {
            decrement: dec(amount),
          },
          version: { increment: 1 },
        },
      });

      await tx.account.update({
        where: { id: acc.PENDING.id },
        data: {
          balance: {
            increment: dec(amount),
          },
          version: { increment: 1 },
        },
      });

      return w;
    });
  }

  @Post('support')
  async support(
    @Req() r: any,
    @Body() b: any,
  ) {
    if (!b.subject || !b.message) {
      throw new BadRequestException(
        'Subject and message required',
      );
    }

    return this.db.supportTicket.create({
      data: {
        userId: r.user.sub,
        subject: b.subject,
        category: b.category || 'Other',
        message: b.message,
      },
    });
  }

  @Post('webhooks/demo')
  async webhook(
    @Headers('x-webhook-secret') secret: string,
    @Body() b: any,
  ) {
    if (
      secret !==
      (process.env.WEBHOOK_SECRET ||
        'demo-webhook-secret')
    ) {
      throw new ForbiddenException();
    }

    if (!b.eventId || !b.depositId) {
      throw new BadRequestException();
    }

    const existing =
      await this.db.webhookEvent.findUnique({
        where: { eventId: b.eventId },
      });

    if (existing) {
      return {
        ok: true,
        idempotent: true,
      };
    }

    await this.db.webhookEvent.create({
      data: {
        provider: b.provider || 'demo',
        eventId: b.eventId,
        payload: b,
        status: 'RECEIVED',
      },
    });

    return {
      ok: true,
      received: true,
    };
  }
}

@Controller('admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private db: PrismaService) {}

  private guard(r: any) {
    if (
      r.user.role !== 'ADMIN' &&
      r.user.role !== 'SUPPORT'
    ) {
      throw new ForbiddenException(
        'Staff only',
      );
    }
  }

  @Get('tickets')
  async tickets(@Req() r: any) {
    this.guard(r);

    return this.db.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: { email: true },
        },
      },
    });
  }

  @Post('tickets/:id/status')
  async status(
    @Req() r: any,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    this.guard(r);

    return this.db.supportTicket.update({
      where: { id },
      data: { status: b.status },
    });
  }

  @Get('users')
  async users(@Req() r: any) {
    this.guard(r);

    return this.db.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('reconciliation')
  async reconciliation(@Req() r: any) {
    this.guard(r);

    const accounts =
      await this.db.account.groupBy({
        by: ['type', 'currency'],
        _sum: { balance: true },
      });

    return {
      generatedAt: new Date(),
      accounts,
      warning:
        'Production reconciliation should compare provider and blockchain settlement records.',
    };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [
    FinanceController,
    AdminController,
  ],
  providers: [
    PrismaService,
    AuthGuard,
  ],
})
export class FinanceModule {}
