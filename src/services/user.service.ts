import { forwardRef, HttpException, Inject, Injectable } from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AuthenticationService } from '../auth/authtication.service';
import { InfoItem } from '../entities/info-item.entity';
import { Organization } from '../entities/organization.entity';
import { Role } from '../entities/role.entity';
import { UserInfo } from '../entities/user-info.entity';
import { User } from '../entities/user.entity';
import { JwtReply } from '../interfaces/jwt.interface';
import { CreateUserInput, UpdateUserInput, UserInfoData } from '../interfaces/user.interface';
import { CryptoUtil } from '../utils/crypto.util';
import { RoleService } from './role.service';

@Injectable()
export class UserService {
    constructor(
        @InjectEntityManager() private readonly entityManager: EntityManager,
        @InjectRepository(User) private readonly userRepo: Repository<User>,
        @InjectRepository(UserInfo) private readonly userInfoRepo: Repository<UserInfo>,
        @InjectRepository(InfoItem) private readonly infoItemRepo: Repository<InfoItem>,
        @Inject(CryptoUtil) private readonly cryptoUtil: CryptoUtil,
        @Inject(forwardRef(() => AuthenticationService)) private readonly authService: AuthenticationService,
        @Inject(RoleService) private readonly roleService: RoleService
    ) { }

    /**
     * 创建用户
     *
     * @param user 用户对象
     */
    async createUser(createUserInput: CreateUserInput): Promise<void> {
        await this.checkUsernameExist(createUserInput.username);
        createUserInput.password = await this.cryptoUtil.encryptPassword(createUserInput.password);
        const user = await this.userRepo.save(this.userRepo.create(createUserInput));
        // 将当前用户与角色进行关联，保存用户和角色的关系
        if (createUserInput.roleIds && createUserInput.roleIds.length) {
            this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(user).add(createUserInput.roleIds);
        }
        // 如果创建用户时，指定了组织，则将当前用户与组织进行关联，保存用户和组织的关系
        if (createUserInput.organizationIds && createUserInput.organizationIds.length) {
            this.userRepo.createQueryBuilder('user').relation(User, 'organizations').of(user).add(createUserInput.organizationIds);
        }
        // 创建用户时，如果有信息项，则保存用户信息项的值
        if (createUserInput.infoKVs && createUserInput.infoKVs.length) {
            this.createOrUpdateUserInfos(user, createUserInput.infoKVs, 'create');
        }
    }

    /**
     * 给用户添加角色
     *
     * @param userId 用户ID
     * @param roleId 角色ID
     */
    async addUserRole(userId: number, roleId: number) {
        this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(userId).add(roleId);
    }

    /**
     * 删除用户角色
     *
     * @param userId 用户ID
     * @param roleId 角色ID
     */
    async deleteUserRole(userId: number, roleId: number) {
        this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(userId).remove(roleId);
    }

    /**
     * 删除用户到回收站
     *
     * @param id 用户ID
     */
    async recycleUser(id: number): Promise<void> {
        const user = await this.findOneById(id);
        user.recycle = true;
        this.userRepo.save(user);
    }

    /**
     * 删除回收站内的用户
     *
     * @param id 用户ID
     */
    async deleteUser(id: number): Promise<void> {
        const user = await this.userRepo.findOne(id, { relations: ['roles', 'organizations'] });
        this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(user).remove(user.roles);
        this.userRepo.createQueryBuilder('user').relation(User, 'organizations').of(user).remove(user.organizations);
        this.userRepo.remove(user);
    }

    /**
     * 更新用户信息
     *
     * 会根据传入的参数做相应的信息更新
     *
     * @param id 用户ID
     * @param updateUserInput 用户更新的信息数据
     */
    async updateUserInfo(id: number, updateUserInput: UpdateUserInput): Promise<void> {
        const user = await this.userRepo.findOne(id, { relations: ['userInfos'] });
        // 更新邮箱
        if (updateUserInput.email) {
            this.userRepo.update(user.id, { email: updateUserInput.email });
        }
        // 更新手机号
        if (updateUserInput.mobile) {
            this.userRepo.update(user.id, { mobile: updateUserInput.mobile });
        }
        // 更新密码
        if (updateUserInput.password) {
            const newPassword = await this.cryptoUtil.encryptPassword(updateUserInput.password);
            this.userRepo.update(user.id, { password: newPassword });
        }
        // 更新角色
        if (updateUserInput.roleIds && updateUserInput.roleIds.length) {
            updateUserInput.roleIds.forEach(roleId => {
                this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(user).remove(roleId.before);
                this.userRepo.createQueryBuilder('user').relation(User, 'roles').of(user).add(roleId.after);
            });
        }
        // 更新组织
        if (updateUserInput.organizationIds && updateUserInput.organizationIds.length) {
            updateUserInput.organizationIds.forEach(organizationId => {
                this.userRepo.createQueryBuilder('user').relation(User, 'organizations').of(user).remove(organizationId.before);
                this.userRepo.createQueryBuilder('user').relation(User, 'organizations').of(user).add(organizationId.after);
            });
        }
        // 更新用户信息项的值
        if (updateUserInput.infoKVs && updateUserInput.infoKVs.length) {
            this.createOrUpdateUserInfos(user, updateUserInput.infoKVs, 'update');
        }
    }

    /**
     * 通过角色ID查询用户
     *
     * @param roleId 角色ID
     */
    async findByRoleId(roleId: number) {
        const users = await this.entityManager.createQueryBuilder().relation(Role, 'users').of(roleId).loadMany<User>();
        if (!users.length) {
            throw new HttpException('没有用户属于这个角色', 404);
        }
        return this.findUserInfoById(users.map(user => user.id)) as Promise<UserInfoData[]>;
    }

    /**
     * 获取组织下面的用户
     *
     * @param id 组织ID
     */
    async findByOrganizationId(organizationId: number): Promise<UserInfoData[]> {
        const users = await this.entityManager.createQueryBuilder().relation(Organization, 'users').of(organizationId).loadMany<User>();
        if (!users.length) {
            throw new HttpException('没有用户属于这个组织', 404);
        }
        return this.findUserInfoById(users.map(user => user.id)) as Promise<UserInfoData[]>;
    }

    /**
     * 通过用户名查询用户及其关联信息(角色、权限)
     *
     * @param username 用户名
     */
    async findOneWithRolesAndPermissions(username: string): Promise<User> {
        const user = await this.userRepo.findOne({ where: { username }, relations: ['roles', 'roles.permissions'] });
        if (!user) {
            throw new HttpException('用户不存在', 404);
        }
        return user;
    }

    /**
     * 通过用户ID查询用户信息
     *
     * @param id 用户ID
     */
    async findUserInfoById(id: number | number[]): Promise<UserInfoData | UserInfoData[]> {
        const userQb = this.userRepo.createQueryBuilder('user')
            .leftJoinAndSelect('user.roles', 'roles')
            .leftJoinAndSelect('user.organizations', 'organizations')
            .leftJoinAndSelect('user.userInfos', 'userInfos')
            .leftJoinAndSelect('userInfos.infoItem', 'infoItem');

        const infoItemQb = await this.infoItemRepo.createQueryBuilder('infoItem')
            .leftJoin('infoItem.infoGroups', 'infoGroups')
            .leftJoin('infoGroups.role', 'role')
            .leftJoin('role.users', 'users');

        if (id instanceof Array) {
            const userInfoData: UserInfoData[] = [];
            const users = await userQb.whereInIds(id).getMany();
            const infoItems = await infoItemQb.where('users.id IN (:...id)', { id }).orderBy('infoItem.order', 'ASC').getMany();
            for (const user of users) {
                (userInfoData as UserInfoData[]).push(this.refactorUserData(user, infoItems));
            }
            return userInfoData;
        } else {
            const user = await userQb.where('user.id = :id', { id }).getOne();
            const infoItem = await infoItemQb.where('users.id = :id', { id }).orderBy('infoItem.order', 'ASC').getMany();
            return this.refactorUserData(user, infoItem);
        }
    }

    /**
     * 通过用户角色查询其所有的信息项
     *
     * 注册时，只能注册为一种角色，此时信息项为当前角色下的所有信息项；
     * 注册成功后，管理员可以赋予用户更多的角色，添加角色时，需要补全填写被添加角色的所有信息项的值。
     *
     * 管理员添加用户时，可以给用户赋予一种或多种角色，如果是一种角色，信息项与注册时的信息项逻辑一致；
     * 如果是多种角色，需要把所有角色对应的信息项通过其名称(name)去重，然后补全填写所有信息项的值。
     *
     * 显示用户信息时，直接使用用户 id 去查询 user_info 表中数据即可。
     */
    async findOneWithInfoItemsByRoleIds(roleIds: number[]) {
        return this.roleService.findInfoGroupItemsByIds(roleIds);
    }

    /**
     * 用户登录
     *
     * TODO: 登录时，通过用户角色查询其所有的信息项
     *
     * @param username 用户名
     * @param password 密码
     */
    async login(username: string, password: string): Promise<JwtReply> {
        // TODO: 查询用户时，同时查询用户所拥有的所有权限，如果启用了用户模块的缓存选项，则缓存权限
        const user = await this.findOneWithRolesAndPermissions(username);
        if (!await this.cryptoUtil.checkPassword(password, user.password)) {
            throw new HttpException('登录密码错误', 406);
        }

        // TODO: 缓存权限的数据结构
        // const permissions: string[] = [];
        // user.roles.forEach(role => {
        //     role.permissions.forEach(permission => {
        //         permissions.push(permission.identify);
        //     });
        // });

        return this.authService.createToken({ username });
    }

    /**
     * 普通用户注册
     *
     * 入参：用户名、密码、邮箱(可选)、手机号(可选)、普通用户信息项
     *
     * @param username 用户名
     * @param password 密码
     */
    async register(createUserInput: CreateUserInput): Promise<void> {
        createUserInput.roleIds = [1];
        this.createUser(createUserInput);
    }

    /**
     * 通过ID查找用户
     *
     * @param id 用户ID
     */
    private async findOneById(id: number): Promise<User> {
        const exist = this.userRepo.findOne(id);
        if (!exist) {
            throw new HttpException('用户不存在', 404);
        }
        return exist;
    }

    /**
     * 检查用户名是否存在
     *
     * @param username 用户名
     */
    private async checkUsernameExist(username: string): Promise<void> {
        if (await this.userRepo.findOne({ where: { username } })) {
            throw new HttpException('用户名已存在', 409);
        }
    }

    /**
     * 创建或更新用户信息项的值
     *
     * @param user 用户实体
     * @param infoKVs 信息项键值对，key是信息项的ID(infoItem.id)，值是信息项的值(userInfo.value)
     * @param action 操作类型，创建或更新(create | update)
     */
    private async createOrUpdateUserInfos(user: User, infoKVs: { key: number, value: string, relationId?: number }[], action: 'create' | 'update') {
        if (infoKVs.length) {
            if (action === 'create') {
                infoKVs.forEach(async infoKV => {
                    await this.userInfoRepo.save(this.userInfoRepo.create({ value: infoKV.value, user, infoItem: { id: infoKV.key } }));
                });
                return;
            }

            // 更新用户信息项的值
            infoKVs.forEach(async infoKV => {
                if (infoKV.key) {
                    this.userInfoRepo.update(infoKV.key, { value: infoKV.value });
                } else {
                    await this.userInfoRepo.save(this.userInfoRepo.create({ value: infoKV.value, user, infoItem: { id: infoKV.relationId } }));
                }
            });
        }
    }

    /**
     * 重构用户对象
     *
     * @param user 用户对象
     */
    private refactorUserData(user: User, infoItems: InfoItem[]) {
        const userInfoData: UserInfoData = {
            userId: user.id,
            username: user.username,
            email: user.email,
            mobile: user.mobile,
            banned: user.banned,
            recycle: user.recycle,
            userRoles: user.roles,
            userOrganizations: user.organizations,
            userInfos: infoItems.length ? infoItems.map(infoItem => {
                const userInfo = user.userInfos.find(userInfo => userInfo.infoItem.id === infoItem.id);
                /**
                 * 以下逻辑会将信息项与信息项的值进行匹配
                 *
                 * id:
                 * 如果用户信息项都没有完善，即 userInfos 为空，则当前 userInfo 的 id 为 undefined，否则是 userInfo.id
                 *
                 * value:
                 * 如果用户信息项都没有完善，即 userInfos 为空，则当前 userInfo的 value 为 undefined，否则是 userInfo.value
                 *
                 * 当且仅当 userInfo 的 id 为 undefined 时，信息项的修改逻辑变为：判断传入的 infoKVs 的 key 是否为 undefined，如果是则新增信息项的值，否则做正常更新操作
                 */
                return {
                    id: user.userInfos.length ? (userInfo ? userInfo.id : undefined) : undefined,
                    order: infoItem.order,
                    relationId: infoItem.id,
                    type: infoItem.type,
                    name: infoItem.name,
                    value: user.userInfos.length ? (userInfo ? userInfo.value : undefined) : undefined,
                    description: infoItem.description,
                    registerDisplay: infoItem.registerDisplay,
                    informationDisplay: infoItem.informationDisplay
                };
            }) : []
        };
        return userInfoData;
    }
}