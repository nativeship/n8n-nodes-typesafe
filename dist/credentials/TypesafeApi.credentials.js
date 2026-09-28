"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypesafeApi = void 0;
class TypesafeApi {
    constructor() {
        this.name = "typesafeApi";
        this.displayName = "TypeSafe API";
        this.documentationUrl = "https://nativeship.io/nodes/@nativeship/n8n-nodes-typesafe";
        this.icon = {
            light: "file:../nodes/Typesafe/typesafe.svg",
            dark: "file:../nodes/Typesafe/typesafe.dark.svg"
        };
        this.properties = [
            {
                displayName: "Access Token",
                name: "secret",
                type: "string",
                typeOptions: {
                    password: true
                },
                default: "",
                required: true
            }
        ];
        this.authenticate = {
            type: "generic",
            properties: {
                headers: {
                    Authorization: "=Bearer {{$credentials.secret}}"
                }
            }
        };
        this.test = {
            request: {
                baseURL: "https://api.example.com",
                url: "/v1/models"
            }
        };
    }
}
exports.TypesafeApi = TypesafeApi;
//# sourceMappingURL=TypesafeApi.credentials.js.map