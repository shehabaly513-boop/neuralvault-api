import 'reflect-metadata'; import {NestFactory} from '@nestjs/core'; import {Module} from '@nestjs/common'; import {AuthModule} from './auth.module'; import {FinanceModule} from './finance.module';
@Module({imports:[AuthModule,FinanceModule]}) class AppModule{}
async function bootstrap(){const app=await NestFactory.create(AppModule);app.enableCors({origin:true});app.setGlobalPrefix('api');await app.listen(Number(process.env.PORT)||3001,'0.0.0.0')}bootstrap();
