import {Module,Controller,Get} from '@nestjs/common'; import {PrismaClient} from '@prisma/client';
class PrismaService extends PrismaClient{}
@Controller('ledger') class LedgerController{constructor(private db:PrismaService){} @Get('health') health(){return {ok:true,service:'ledger',rule:'backend-authoritative'}}}
@Module({controllers:[LedgerController],providers:[PrismaService]}) export class LedgerModule{}
