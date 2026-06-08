# Deny, Approval, Allow Matrix

| Condition                                   | Decision                                   |
| ------------------------------------------- | ------------------------------------------ |
| Missing required subject/account/tenant     | deny                                       |
| Invalid args                                | deny                                       |
| Capability disabled or deprecated by policy | deny                                       |
| Risk above autonomy ceiling                 | deny or approval required, based on policy |
| Prepare needs human approval                | approval required                          |
| Commit lacks stored prepared action         | deny                                       |
| Host hook throws                            | deny                                       |
| All required checks pass                    | allow                                      |
