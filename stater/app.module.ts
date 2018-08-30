import { Inject, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GraphQLFactory, GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloServer } from 'apollo-server-express';
import * as GraphQLJSON from 'graphql-type-json';

import { AuthenticationService, AuthorizationGurad, UserModule } from '../src';

@Module({
    imports: [
        GraphQLModule,
        TypeOrmModule.forRoot({
            type: 'postgres',
            host: 'localhost',
            port: 5432,
            username: 'postgres',
            password: '123456',
            database: 'module_user',
            entities: [__dirname + '/../src/**/*.entity.ts'],
            logger: 'simple-console',
            logging: false,
            synchronize: true,
            dropSchema: false
        }),
        UserModule
    ],
    controllers: [],
    providers: [
        { provide: APP_GUARD, useClass: AuthorizationGurad },
    ],
    exports: []
})
export class AppModule {
    constructor(
        @Inject(GraphQLFactory) private readonly graphQLFactory: GraphQLFactory,
        @Inject(AuthenticationService) private readonly authService: AuthenticationService
    ) { }

    configureGraphQL(app: any) {
        const typeDefs = this.graphQLFactory.mergeTypesByPaths(__dirname + '/../src/**/*.types.graphql');
        const schema = this.graphQLFactory.createSchema({ typeDefs, resolvers: { JSON: GraphQLJSON } });

        const server = new ApolloServer({
            schema,
            context: async ({ req }) => {
                const user = await this.authService.validateUser(req);
                return { user };
            },
            playground: {
                settings: {
                    'editor.theme': 'light',
                    'editor.cursorShape': 'line'
                }
            }
        });
        server.applyMiddleware({ app });
    }
}