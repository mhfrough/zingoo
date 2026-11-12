import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { STAFF, WRITE_ROLES } from '../auth/access';
import { CrudController } from '../common/crud.controller';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './companies.dto';
import { Company } from './company.entity';

@ApiTags('companies')
@Controller('companies')
export class CompaniesController extends CrudController<Company>({
  create: CreateCompanyDto, update: UpdateCompanyDto, read: STAFF, write: WRITE_ROLES.admin,
}) {
  constructor(service: CompaniesService) {
    super(service);
  }
}
