import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('user')
export class User {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        unique: true
    })
    username: string;

    @Column()
    password: string;

    /**
     * 封禁状态，默认：false
     */
    @Column({
        default: false
    })
    banned: boolean;

    /**
     * 回收状态，默认：false
     */
    @Column({
        default: false
    })
    recycle: boolean;

    /**
     * 操作员ID，在数据创建时，保存创建这条数据的操作员ID
     */
    @Column({
        name: 'create_by'
    })
    createBy: number;

    /**
     * 操作员ID，在数据更新时，保存更新这条数据的操作员ID
     */
    @Column({
        name: 'update_by'
    })
    updateBy: number;

    @CreateDateColumn()
    createTime: Date;

    @UpdateDateColumn()
    updateTime: Date;
}