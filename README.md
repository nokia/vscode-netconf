## NETCONF for Visual Studio Code

This vsCode extension implements an interactive NETCONF client, that runs
against NETCONF servers, such as NOKIA 7750 Service Routers. By integrating
NETCONF with Visual Studio Code, users will be able to extend the industry
leading open-source code editor and integrated development environment by
the ability to communicate with latest networking equipment using the
NETCONF protocol.

The extension is implemented in native JavaScript/TypeScript and works
on your desktop system of choice (Windows, macOS, Linux).

This NETCONF client implements NETCONF over SSHv2 as described in
[RFC 6242](https://tools.ietf.org/html/rfc6242).
Both base:1.0 *end-of-message framing* and base:1.1 *chunked-framing* are
supported. Authentication supports username with password or keys.

To use this extension, it is required to specify connection details in the
extension settings.

![NETCONF Settings](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/ExtensionSettings.png)

The list of NETCONF servers must be provided in JSON format like this:

		"netconf.serverList": [
			{
				"id": "admin@localhost",
				"host": "localhost",
				"port": 830,
				"username": "admin",
				"password": "admin"
			},
			{
				"id": "PE1",
				"host": "192.168.0.100",
				"port": 830,
				"username": "admin"
			}
		]

All features are accessible from vsCode Command Palette. For convenience,
shortcuts are provided from the statusbar (used as toolbar) and the editor
title for XML files.

## License

This project is licensed under the BSD 3-Clause license - see the
[LICENSE](https://github.com/nokia/vscode-netconf/blob/master/LICENSE).

**Copyright (c) 2023 NOKIA**