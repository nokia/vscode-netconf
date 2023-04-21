# NETCONF for Visual Studio Code

![vscode-netconf](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/vscode-netconf.gif)

## About

This vsCode extension implements an interactive NETCONF client, that runs
against NETCONF servers, such as NOKIA 7750 Service Routers. By integrating
NETCONF with Visual Studio Code, users will be able to extend the industry
leading open-source code editor and integrated development environment by
the ability to communicate with latest networking equipment using the
NETCONF protocol.

The extension is implemented in native JavaScript/TypeScript and works
on your desktop system of choice (Windows, macOS, Linux).

## Build

To build this extension, you can use the Visual Studio Code Extensions
command-line tool called 
[vsce](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).


```bash
$ git clone https://github.com/nokia/vscode-netconf
$ cd vscode-netconf
$ npm install .
$ vsce package
```

To simplify installation and updates we are planning to make `vscode-netconf` available on Visual Studio Code
[Extensions Marketplace](https://marketplace.visualstudio.com/vscode) soon!

## Contributions

We are happy to have people contributing to this project. If you have feature
request or if you want to report misfunctions, feel free to raise
[Issues](https://github.com/nokia/netconf-examples/issues).

If you want to contribute code-changes, you can contribute directly via
normal pull-request procedure.

## Getting Started!

To use this extension, it is required to specify connection details in the
extension settings.

![NETCONF Settings](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/ExtensionSettings.png)

The list of NETCONF servers must be provided in JSON format like this:

```json
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
```

All features are accessible from vsCode Command Palette. For convenience,
shortcuts are provided from the statusbar (used as toolbar) and the editor
title for XML files.

![Client Connected](https://raw.githubusercontent.com/nokia/vscode-netconf/master/resources/ClientConnected.png)

## Supported Features

* **Support for NETCONF over SSHv2**

  [RFC 6241](https://tools.ietf.org/html/rfc6241) and
  [RFC 6242](https://tools.ietf.org/html/rfc6242) compliant NETCONF client,
  fully integrated with Visual Studio Code. Both **end-of-message framing*
  and *chunked-framing* (base:1.0 and base:1.1) are supported.
  
* **Authentication support: username/password and key-based**

* **Connection control**

  The user has control when to connect/disconnect to the NETCONF server.
  All RPC request are send over the same NETCONF session as long the user is
  connected. This allows execute complex flows like `lock` > `edit-config` >
  `validate` > `confirmed-commit` > `confirm` > `unlock`.
  It's also an enabler to receive event notifications.

* **Support for NETCONF event notifications**

  The `vscode-netconf` extension is
  [RFC 5277](https://tools.ietf.org/html/rfc6241) compliant to receive
  NETCONF event notifications. Events will be buffered and while the
  status-bar shows the number of received events. By clicking on the
  events icon in the status-bar, a new TextDocument containing the
  buffered notifications will be opened and the buffer gets cleared.

* **Examples library**

  NETCONF request examples are available from
  https://github.com/nokia/netconf-examples and can be added to the `vscode`
  workspace from the status-bar.

  By default, the example library will be cloned to the users home directory.
  You can set the `git.defaultCloneDirectory` in the Visual Studio Code
  settings to an alternative folder like "~/Development" based on your
  personal needs.

  We are planning to have coverage for IETF, OpenConfig and vendor-models
  (Nokia).

* **Access to server SSH greetings, SSH banner**

* **Access to NETCONF `<hello/>` messages**

* **Option: Prettify XML**

  From the extension settings it is possible to activate the
  `NETCONF: prettify` option. This is useful, when NETCONF servers return
  minified XML.

* **Option: SSH debug**

  To troubleshoot SSHv2 related issues, like handshake problems around
  ciphers, and key-exchange algorithms, SSH debugging can be enabled.
  To check the logs, use the console-view part of `Developer tools`
  (accessible from `Help`).

* **Option: SSH keep-alive**

  Keep-alives can be enabled to automatically detect, if the underlying
  SSHv2 session has died.

* **Status-bar icons**

  The status-bar allows to pick a NETCONF server from the list of configured
  servers (extension settings), and to connect/disconnect to the server. If
  connected, the system will show how much data has been received so far
  from the NETCONF server.

  In addition, it is possible execute unfiltered `<get/>` and `<get-config/>`
  requests directly from status-bar, without the need to open the command
  palette.

  If the connected NETCONF server supports the candidate datastore, additional
  icons will appear to lock/unlock, validate, discard changes and commit the candidate datastore.

* **Send RPC from Editor Title**

  If an XML document is opened in a TextEditor, the `Run` menu will provide
  a shortcut to send this as request to the NETCONF server.

## Compatibility

Following vendors and device families have been tested so far:

| Vendor | Product Family | Router OS |
|---|---|---|
| Ciena | 5000 series | SAOS 10.9 |
| Cisco | NCS 540 series | IOS-XR 7.9.1 |
| Ericsson | 6000 series | IPOS 23.1 |
| Huawei | NetEngine 8000 series | rel 8.22/1 |
| Juniper | MX series | JunOS 22.4R1 |
| Nokia | 7750 SR family | SR OS 22.10<br>SR OS 23.3 |

We don't mind to get access to 3rd party equipment (preferred virtual
router/simulator images as virtual-machine or docker), test licenses and
some basic instructions to extend the scope of our testing, improve
compatibility and extend the capabilities.

## Known issues

* NETCONF responses are opened as new `TextDocument`. Visual Studio Code is
  automatically setting the `isDirty` tag, while you can't simple close the
  document as the `Save As` dialogue will always show up.

  Related to vscode-issue [#154664](https://github.com/microsoft/vscode/issues/154664).

* NETCONF responses will open as `Untitled TextDocument`. It's not possible
  to provide meaningful tab-names. Ideally, we would pre-define a file://
  location, that it could be saved by simply doing CTRL-S / CMD-S without
  `Save As` popup.

  Related to vscode-issue [#41909](https://github.com/microsoft/vscode/issues/41909).

* The vscode-netconf extension uses the API methods `showInformationMessage()`,
  `showWarningMessage()`, and `showErrorMessage()`. Messages are displayed as plain
  text without differentiation between message title and details and there is no
  possibility to show preformatted text and enforce line-breaks. In consequence,
  SSH banners are not displayed very nicely.

* In [atom-netconf](https://github.com/nokia/atom-netconf) we've provided an
  option to enable audio feedback to improve accessibility. For an unknown reason,
  we've not been able to get this working using vscode. As vscode has added a
  feature called
  [AudioCues](https://code.visualstudio.com/docs/editor/accessibility#_audio-cues)
  in June 2022, we may need to wait until the
  [Extensions API](https://code.visualstudio.com/api/references/vscode-api)
  gets extended to allow extensions to play audio.

  Related to vscode-issue [#175986](https://github.com/microsoft/vscode/issues/175986).

* Under rare conditions, NETCONF-over-SSH session death is not properly propagated.
  SSH-level keepalive mechanism can be activated to improve session health checks.
  If for whatever reason the underlying session died but extension state including
  status-bar was not updated, you can execute `Developer: Reload Window` from the
  Visual Studio command-palette. This will enforce the restart all extensions and
  fixes the issue.

## Feature candidates

We've captured the following feature candidates for future evolution:

* **Device Information**

  Capturing device-level information and display to the user (Vendor, Device
  Family, Chassis Type, Release, CPU, Memory, Temperature, Power Consumption,
  Ports/Interfaces, LLDP Neighbors).

* **Telemetry Support**

  Add extension telemetry to collect information about how `vscode-netconf` is
  used. This is to provide better visibility about the number of active users
  and how this extension is used. We are planning to publish some trending
  regarding vendors/device-families, the industry support of IETF NETCONF
  features and standard YANG models (IETF, OpenConfig). In addition, we
  would use telemetry to improve error-handling and compatibility issues.

* **Make extension YANG-aware**

  Use the same concept as [pysros](https://github.com/nokia/pysros) to build
  a local YANG library, based on the model-set that is supported by the
  NETCONF server.

  Following advanced features to be supported:
  - Display model-path / xpath from cursor position
  - Model-aware conversion between XML and JSON
  - Model-aware compare between two model-instances
  - Build a edit-config request from a get-config response
  - Table-editor for YANG lists
  - Run xpath queries
  - Advanced edition using IntelliSense:
    Error detection, Auto-completion, Suggests, Help on Hover

* **Integrated Diff**

  Graphical compare of running vs candidate datastores.

Contributions are welcome, to help improving the usability of `vscode-netconf`.

## Changes
### Release 1.1.0

- Client capabilities are now configurable in the `netconf.serverList`.
  By default, `vscode-netconf` is sending the `base:1.0` and `base:1.1`
  capabilities to the server. By making the capabilities configurable,
  the desired framing mechanism can be enforced. In addition, it is
  possible to enable device-level feature like private candidates in
  Nokia SR OS.
- The execution time for RPCs is now captured and shown to the user.
  This is to get some initial idea on performance for a given
  `edit-config` or `commit` RPC. It is targeted for integrators
  to optimize the communication to the server and to implement
  response time-outs.

  The execution time is only shown to RPCs that return a simple
  `</ok>` as part of the confirmation dialogue. It's not available
  for RPCs that return detailed responses like `<get>`, `<get-config`.
  For those cases, it is shown in the console-log only.

## License

This project is licensed under the BSD 3-Clause license - see the
[LICENSE](https://github.com/nokia/vscode-netconf/blob/master/LICENSE).

**Copyright (c) 2023 NOKIA**