package com.example.service;

import com.example.common.GreetingProvider;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class ServiceAppApplication {
  public static void main(String[] args) {
    SpringApplication.run(ServiceAppApplication.class, args);
  }

  @Bean
  GreetingProvider greetingProvider() {
    return new GreetingProvider();
  }

  @RestController
  static class GreetingController {
    private final GreetingProvider greetingProvider;

    GreetingController(GreetingProvider greetingProvider) {
      this.greetingProvider = greetingProvider;
    }

    @GetMapping("/hello")
    String hello() {
      return greetingProvider.message();
    }
  }
}
