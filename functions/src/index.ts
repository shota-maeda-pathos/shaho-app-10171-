import './config';

// 従業員API
export { employeeCreate } from './employees/employee-create/functions';
export { employeeList } from './employees/employee-list/functions';
export { employeeGet } from './employees/employee-get/functions';
export { employeeUpdate } from './employees/employee-update/functions';
export { employeeDelete } from './employees/employee-delete/functions';
export { employeeTransfer } from './employees/employee-transfer/functions';
export { employeeResign } from './employees/employee-resign/functions';

// 扶養家族API
export { dependentCreate } from './dependents/dependent-create/functions';
export { dependentList } from './dependents/dependent-list/functions';
export { dependentGet } from './dependents/dependent-get/functions';
export { dependentUpdate } from './dependents/dependent-update/functions';
export { dependentDelete } from './dependents/dependent-delete/functions';
