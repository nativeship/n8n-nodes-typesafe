import { type IAuthenticateGeneric, type Icon, type ICredentialTestRequest, type ICredentialType, type INodeProperties } from "n8n-workflow";

// Generated with ts-morph
export class TypesafeApi implements ICredentialType {
  name = "typesafeApi";
  displayName = "TypeSafe API";
  documentationUrl = "https://docs.typesafe.ai/primitives?utm_source=n8n_app&utm_medium=node_settings_modal-credential_link&utm_campaign=@nativeship/n8n-nodes-typesafe";
  icon: Icon = {
        light: "file:../nodes/Typesafe/typesafe.svg",
        dark: "file:../nodes/Typesafe/typesafe.dark.svg"
    };
  properties: INodeProperties[] = [
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
  authenticate: IAuthenticateGeneric = {
        type: "generic",
        properties: {
            headers: {
                Authorization: "=Bearer {{$credentials.secret}}"
            }
        }
    };
  test: ICredentialTestRequest = {
        request: {
            baseURL: "https://api.typesafe.ai",
            url: "/v1/models"
        }
    };
}
